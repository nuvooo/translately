import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common'
import { Project } from '@prisma/client'
import { PrismaService } from '../../shared/prisma.service'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { writeAudit } from '../audit-logs/write-audit'
import { ChangeEventsService } from '../change-events/change-events.service'
import { DEFAULT_NAMESPACE, DEFAULT_SCOPE, MAX_IMPORT_KEYS } from './limits'
import {
  ValueWrite,
  WriteProgress,
  writeValues,
} from './translation-bulk-writer'
import { TranslationFilesService } from './translation-files.service'
import {
  buildTree,
  findKeyConflicts,
  flattenTree,
  SkippedEntry,
} from './translation-tree'

export interface ImportTarget {
  language: string
  namespace?: string
  brandId?: string
}
export interface ImportPreview {
  added: string[]
  changed: string[]
  unchanged: string[]
  newKeys: string[]
  skipped: SkippedEntry[]
}

type ProjectRecord = Pick<
  Project,
  'id' | 'organizationId' | 'type' | 'languages' | 'namespaces'
>

interface ResolvedTarget {
  project: ProjectRecord
  language: string
  namespace: string
  brandId: string | null
  /** Stored scope of the view's own texts: 'default' or the brand id. */
  scope: string
}

/** What an import would do; `apply` writes exactly this. */
interface ImportPlan {
  target: ResolvedTarget
  preview: ImportPreview
  /** Imported texts without an own row (key -> text); may belong to a new key. */
  creates: Array<{ key: string; value: string }>
  /** Own rows whose text differs (existing key id -> text). */
  updates: Array<{ keyId: string; value: string }>
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002'
}

const byKey = (a: SkippedEntry, b: SkippedEntry) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0

/**
 * Imports one i18next file (nested or flat JSON) into one view (language, namespace and the standard texts or one brand's overrides), and
 * exports one view again. An import only adds and changes texts; it never
 * deletes anything.
 */
@Injectable()
export class TranslationImportService {
  private readonly logger = new Logger(TranslationImportService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: TranslationFilesService,
    private readonly changes: ChangeEventsService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async preview(
    projectId: string,
    target: ImportTarget,
    content: unknown
  ): Promise<ImportPreview> {
    return (await this.plan(projectId, target, content)).preview
  }

  async apply(
    projectId: string,
    userId: string,
    target: ImportTarget,
    content: unknown
  ): Promise<ImportPreview> {
    let plan = await this.plan(projectId, target, content)
    // Shared by both attempts: did any text write start?
    const progress: WriteProgress = { started: false }
    try {
      try {
        await this.write(plan, userId, progress)
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        // Another writer created a key or text in between: re-read and retry once.
        plan = await this.plan(projectId, target, content)
        try {
          await this.write(plan, userId, progress)
        } catch (retryError) {
          if (!isUniqueViolation(retryError)) throw retryError
          throw new ConflictException(
            'The translations were changed concurrently, please retry the import'
          )
        }
      }
    } catch (error) {
      // Texts may already be stored: bump the version so clients refetch.
      if (progress.started) this.recordImported(plan.target)
      throw error
    }

    const { preview } = plan
    const nothingNew = preview.added.length + preview.changed.length === 0
    // A failed first attempt may have written what the retry then found
    // unchanged; the version still has to move.
    if (!nothingNew || progress.started) this.recordImported(plan.target)
    if (nothingNew) return preview

    const { project, language, namespace, scope } = plan.target
    await writeAudit(this.auditLogs, this.logger, {
      action: 'translation.imported',
      entityType: 'Project',
      entityId: projectId,
      userId,
      organizationId: project.organizationId,
      projectId,
      newValues: {
        language,
        namespace,
        scope,
        added: preview.added.length,
        changed: preview.changed.length,
        skipped: preview.skipped.length,
      },
    })
    return preview
  }

  /** Nested file of the view: own plus inherited texts. A language the view does not offer → 400. */
  async exportFile(
    projectId: string,
    target: ImportTarget
  ): Promise<{
    namespace: string
    language: string
    tree: Record<string, unknown>
  }> {
    const resolved = await this.resolveTarget(projectId, target)
    const file = await this.files.getFile({
      project: resolved.project as Project,
      namespace: resolved.namespace,
      language: resolved.language,
      brandId: resolved.brandId,
    })
    return {
      namespace: resolved.namespace,
      language: resolved.language,
      tree: buildTree(file),
    }
  }

  private async plan(
    projectId: string,
    target: ImportTarget,
    content: unknown
  ): Promise<ImportPlan> {
    if (
      typeof content !== 'object' ||
      content === null ||
      Array.isArray(content)
    ) {
      throw new BadRequestException('content must be a JSON object')
    }
    // Counted before any database work; invalid entries count as well.
    const { entries, skipped } = flattenTree(content)
    const importedKeys = Object.keys(entries)
    if (importedKeys.length + skipped.length > MAX_IMPORT_KEYS) {
      throw new PayloadTooLargeException(
        `Too many entries (max. ${MAX_IMPORT_KEYS})`
      )
    }

    const resolved = await this.resolveTarget(projectId, target)
    const { project, language, namespace, brandId, scope } = resolved

    // Read 1: all keys of the namespace.
    const keyRows = await this.prisma.translationKey.findMany({
      where: { projectId, namespace },
      select: { id: true, key: true },
    })
    const keyIds = new Map<string, string>()
    for (const row of keyRows) keyIds.set(row.key, row.id)

    const { accepted, conflicts } = findKeyConflicts(
      importedKeys,
      keyRows.map((row) => row.key)
    )

    // Read 2: own texts (and, in a brand view, the inherited standard texts).
    const existingIds: string[] = []
    for (const key of accepted) {
      const id = keyIds.get(key)
      if (id !== undefined) existingIds.push(id)
    }
    const scopes =
      brandId === null
        ? [DEFAULT_SCOPE]
        : project.languages.includes(language)
          ? [DEFAULT_SCOPE, brandId]
          : [brandId]
    const values =
      existingIds.length === 0
        ? []
        : await this.prisma.translationValue.findMany({
            where: {
              projectId,
              language,
              scope: { in: scopes },
              keyId: { in: existingIds },
            },
            select: { keyId: true, scope: true, value: true },
          })
    const own = new Map<string, string>()
    const inherited = new Map<string, string>()
    for (const v of values) {
      if (v.scope === scope) own.set(v.keyId, v.value)
      else if (v.scope === DEFAULT_SCOPE) inherited.set(v.keyId, v.value)
    }

    const added: string[] = []
    const changed: string[] = []
    const unchanged: string[] = []
    const newKeys: string[] = []
    const creates: ImportPlan['creates'] = []
    const updates: ImportPlan['updates'] = []
    for (const key of accepted) {
      const value = entries[key]
      const keyId = keyIds.get(key)
      if (keyId === undefined) newKeys.push(key)
      const current = keyId === undefined ? undefined : own.get(keyId)
      if (current === undefined) {
        // A brand text equal to the inherited standard text is not stored.
        if (keyId !== undefined && inherited.get(keyId) === value) {
          unchanged.push(key)
        } else {
          added.push(key)
          creates.push({ key, value })
        }
      } else if (current !== value) {
        changed.push(key)
        updates.push({ keyId: keyId as string, value })
      } else {
        unchanged.push(key)
      }
    }

    return {
      target: resolved,
      preview: {
        added: added.sort(),
        changed: changed.sort(),
        unchanged: unchanged.sort(),
        newKeys: newKeys.sort(),
        skipped: [
          ...skipped,
          ...conflicts
            .map((c) => ({ key: c.key, reason: 'conflict' as const }))
            .sort(byKey),
        ],
      },
      creates,
      updates,
    }
  }

  /** One change for the import (fire and forget, never throws). */
  private recordImported(target: ResolvedTarget): void {
    const { project, language, namespace } = target
    void this.changes.recordChange({
      organizationId: project.organizationId,
      projectId: project.id,
      changes: [{ namespace, language, action: 'imported' }],
    })
  }

  /** Two key calls plus writeValues' chunked calls (bounded by count and size), never a delete. */
  private async write(
    plan: ImportPlan,
    userId: string,
    progress: WriteProgress
  ): Promise<void> {
    const { project, language, namespace, scope } = plan.target
    const projectId = project.id

    if (plan.preview.newKeys.length > 0) {
      await this.prisma.translationKey.createMany({
        data: plan.preview.newKeys.map((key) => ({
          projectId,
          organizationId: project.organizationId,
          namespace,
          key,
          createdById: userId,
        })),
      })
    }
    const row = (keyId: string, value: string): ValueWrite => ({
      keyId,
      projectId,
      language,
      scope,
      value,
    })
    const creates: ValueWrite[] = []
    if (plan.creates.length > 0) {
      const rows = await this.prisma.translationKey.findMany({
        where: {
          projectId,
          namespace,
          key: { in: plan.creates.map((c) => c.key) },
        },
        select: { id: true, key: true },
      })
      // Ids of the keys just created (and of existing ones) in one read.
      const keyIds = new Map(rows.map((r) => [r.key, r.id]))
      for (const c of plan.creates) {
        const keyId = keyIds.get(c.key)
        if (keyId !== undefined) creates.push(row(keyId, c.value))
      }
    }

    await writeValues(
      this.prisma,
      this.logger,
      creates,
      plan.updates.map((u) => row(u.keyId, u.value)),
      userId,
      progress
    )
  }

  private async resolveTarget(
    projectId: string,
    target: ImportTarget
  ): Promise<ResolvedTarget> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        organizationId: true,
        type: true,
        languages: true,
        namespaces: true,
      },
    })
    if (!project) throw new NotFoundException('Project not found')

    const namespace = target.namespace ?? DEFAULT_NAMESPACE
    if (!project.namespaces.includes(namespace)) {
      throw new BadRequestException(`Unknown namespace "${namespace}"`)
    }

    let languages = project.languages
    let brandId: string | null = null
    if (target.brandId) {
      if (project.type !== 'MULTI') {
        throw new BadRequestException('This project has no brands')
      }
      const brand = await this.prisma.brand.findFirst({
        where: { id: target.brandId, projectId },
        select: { id: true, languages: true },
      })
      if (!brand) throw new NotFoundException('Brand not found')
      languages = brand.languages
      brandId = brand.id
    }
    // Compared exactly as entered (pt-BR and pt-br differ).
    if (!languages.includes(target.language)) {
      throw new BadRequestException(
        `Language "${target.language}" is not enabled for this view`
      )
    }

    return {
      project,
      language: target.language,
      namespace,
      brandId,
      scope: brandId ?? DEFAULT_SCOPE,
    }
  }
}
