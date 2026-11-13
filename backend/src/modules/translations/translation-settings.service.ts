import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../shared/prisma.service'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { writeAudit } from '../audit-logs/write-audit'
import { ChangeEventsService } from '../change-events/change-events.service'
import { TranslationChange } from '../change-events/change-events.types'
import {
  DEFAULT_NAMESPACE,
  DEFAULT_SCOPE,
  LANGUAGE_PATTERN,
  MAX_LANGUAGES,
  MAX_NAMESPACES,
  NAMESPACE_PATTERN,
} from './limits'

/**
 * Validates and de-duplicates a language list. Codes are compared exactly
 * (case-sensitive); the first occurrence keeps its position.
 */
export function normalizeLanguages(languages: unknown): string[] {
  if (!Array.isArray(languages)) {
    throw new BadRequestException('languages must be an array')
  }
  const result: string[] = []
  for (const code of languages) {
    if (typeof code !== 'string' || !LANGUAGE_PATTERN.test(code)) {
      throw new BadRequestException(`Invalid language code "${String(code)}"`)
    }
    if (!result.includes(code)) result.push(code)
  }
  if (result.length > MAX_LANGUAGES) {
    throw new BadRequestException(
      `At most ${MAX_LANGUAGES} languages are allowed`
    )
  }
  return result
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/** Message of the 409 for a write based on an outdated list. */
export const STALE_LANGUAGES_MESSAGE =
  'Die Sprachliste wurde inzwischen geändert'

/**
 * Throws 409 when the client's `expected` list is not the stored one.
 * `null` counts as absent (the DTO already rejects it with 400).
 */
function assertExpected(
  stored: string[],
  expected: string[] | null | undefined
) {
  if (expected != null && !sameList(stored, expected)) {
    throw new ConflictException(STALE_LANGUAGES_MESSAGE)
  }
}

/** Project/brand language lists and project namespaces. */
@Injectable()
export class TranslationSettingsService {
  private readonly logger = new Logger(TranslationSettingsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ChangeEventsService,
    private readonly auditLogs: AuditLogsService
  ) {}

  /**
   * Removing a language deletes the project's standard texts
   * (`scope = 'default'`) in it. With `expected`, the list is only written
   * while the stored list still equals it (409 otherwise, nothing changes).
   */
  async setProjectLanguages(
    projectId: string,
    userId: string,
    languages: string[],
    expected?: string[] | null
  ): Promise<{ languages: string[]; removedValues: number }> {
    const next = normalizeLanguages(languages)
    const project = await this.loadProject(projectId)
    assertExpected(project.languages, expected)
    if (sameList(project.languages, next)) {
      return { languages: next, removedValues: 0 }
    }

    const removed = project.languages.filter((l) => !next.includes(l))
    const deleteRemoved = (client: Prisma.TransactionClient) =>
      client.translationValue.deleteMany({
        where: {
          projectId,
          scope: DEFAULT_SCOPE,
          language: { in: removed },
        },
      })
    let removedValues = 0
    if (expected != null) {
      removedValues = await this.writeIfUnchanged(
        'projects',
        projectId,
        expected,
        (tx, matchesExpected) =>
          tx.project.updateMany({
            where: { id: projectId, ...matchesExpected },
            data: { languages: { set: next } },
          }),
        removed.length > 0 ? deleteRemoved : null
      )
    } else {
      const update = this.prisma.project.update({
        where: { id: projectId },
        data: { languages: { set: next } },
      })
      if (removed.length === 0) {
        await update
      } else {
        const [, deleted] = await this.prisma.$transaction([
          update,
          deleteRemoved(this.prisma),
        ])
        removedValues = deleted.count
      }
    }

    this.recordLanguagesChanged(
      project.organizationId,
      projectId,
      project.languages,
      next
    )
    await writeAudit(this.auditLogs, this.logger, {
      action: 'translation.languages_changed',
      entityType: 'Project',
      entityId: projectId,
      userId,
      organizationId: project.organizationId,
      projectId,
      oldValues: { languages: project.languages },
      newValues: { languages: next },
    })
    return { languages: next, removedValues }
  }

  /**
   * A brand's list is independent of the project's. Removing a language
   * deletes that brand's own texts (`scope = brandId`) in it.
   */
  async setBrandLanguages(
    brandId: string,
    userId: string,
    languages: string[],
    expected?: string[] | null
  ): Promise<{ languages: string[]; removedValues: number }> {
    const next = normalizeLanguages(languages)
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: {
        id: true,
        projectId: true,
        languages: true,
        project: { select: { organizationId: true, type: true } },
      },
    })
    if (!brand?.project) throw new NotFoundException('Brand not found')
    if (brand.project.type !== 'MULTI') {
      throw new BadRequestException('This project has no brands')
    }
    assertExpected(brand.languages, expected)
    if (sameList(brand.languages, next)) {
      return { languages: next, removedValues: 0 }
    }

    const removed = brand.languages.filter((l) => !next.includes(l))
    const deleteRemoved = (client: Prisma.TransactionClient) =>
      client.translationValue.deleteMany({
        where: {
          projectId: brand.projectId,
          scope: brandId,
          language: { in: removed },
        },
      })
    let removedValues = 0
    if (expected != null) {
      removedValues = await this.writeIfUnchanged(
        'brands',
        brandId,
        expected,
        (tx, matchesExpected) =>
          tx.brand.updateMany({
            where: { id: brandId, ...matchesExpected },
            data: { languages: { set: next } },
          }),
        removed.length > 0 ? deleteRemoved : null
      )
    } else {
      const update = this.prisma.brand.update({
        where: { id: brandId },
        data: { languages: { set: next } },
      })
      if (removed.length === 0) {
        await update
      } else {
        const [, deleted] = await this.prisma.$transaction([
          update,
          deleteRemoved(this.prisma),
        ])
        removedValues = deleted.count
      }
    }

    const { organizationId } = brand.project
    this.recordLanguagesChanged(
      organizationId,
      brand.projectId,
      brand.languages,
      next
    )
    await writeAudit(this.auditLogs, this.logger, {
      action: 'translation.languages_changed',
      entityType: 'Brand',
      entityId: brandId,
      userId,
      organizationId,
      projectId: brand.projectId,
      oldValues: { languages: brand.languages },
      newValues: { languages: next },
    })
    return { languages: next, removedValues }
  }

  /** Idempotent: an existing namespace returns the unchanged list. */
  async addNamespace(
    projectId: string,
    userId: string,
    namespace: string
  ): Promise<{ namespaces: string[] }> {
    if (typeof namespace !== 'string' || !NAMESPACE_PATTERN.test(namespace)) {
      throw new BadRequestException('Invalid namespace')
    }
    const project = await this.loadProject(projectId)
    if (project.namespaces.includes(namespace)) {
      return { namespaces: project.namespaces }
    }
    if (project.namespaces.length >= MAX_NAMESPACES) {
      throw new BadRequestException(
        `At most ${MAX_NAMESPACES} namespaces are allowed`
      )
    }

    const namespaces = [...project.namespaces, namespace]
    await this.prisma.project.update({
      where: { id: projectId },
      data: { namespaces: { set: namespaces } },
    })

    this.record(project.organizationId, projectId, {
      namespace,
      action: 'created',
    })
    await writeAudit(this.auditLogs, this.logger, {
      action: 'translation.namespace_added',
      entityType: 'Project',
      entityId: projectId,
      userId,
      organizationId: project.organizationId,
      projectId,
      newValues: { namespace },
    })
    return { namespaces }
  }

  /** Deletes the namespace's keys and their values. `'translation'` cannot be removed. */
  async removeNamespace(
    projectId: string,
    userId: string,
    namespace: string
  ): Promise<{ namespaces: string[]; removedKeys: number }> {
    if (namespace === DEFAULT_NAMESPACE) {
      throw new BadRequestException(
        `The namespace "${DEFAULT_NAMESPACE}" cannot be removed`
      )
    }
    const project = await this.loadProject(projectId)
    if (!project.namespaces.includes(namespace)) {
      throw new NotFoundException('Namespace not found')
    }

    const keys = await this.prisma.translationKey.findMany({
      where: { projectId, namespace },
      select: { id: true, locked: true },
    })
    const lockedKeys = keys.filter((k) => k.locked === true).length
    if (lockedKeys > 0) {
      throw new ConflictException({
        message: `The namespace "${namespace}" contains ${lockedKeys} locked key(s) and cannot be removed. Unlock them first.`,
        code: 'key_locked',
      })
    }
    const namespaces = project.namespaces.filter((n) => n !== namespace)
    // Values are deleted explicitly instead of relying on Prisma's emulated cascade.
    const [, deletedKeys] = await this.prisma.$transaction([
      this.prisma.translationValue.deleteMany({
        where: { projectId, keyId: { in: keys.map((k) => k.id) } },
      }),
      this.prisma.translationKey.deleteMany({
        where: { projectId, namespace },
      }),
      this.prisma.project.update({
        where: { id: projectId },
        data: { namespaces: { set: namespaces } },
      }),
    ])
    const removedKeys = deletedKeys.count

    this.record(project.organizationId, projectId, {
      namespace,
      action: 'deleted',
    })
    await writeAudit(this.auditLogs, this.logger, {
      action: 'translation.namespace_removed',
      entityType: 'Project',
      entityId: projectId,
      userId,
      organizationId: project.organizationId,
      projectId,
      oldValues: { namespace, removedKeys },
    })
    return { namespaces, removedKeys }
  }

  /**
   * Conditional list write: `update` gets a filter that only matches while
   * the stored list still equals `expected`. No match means the list changed
   * since the client loaded it: the transaction is aborted with 409 before
   * any text is deleted. A MongoDB write conflict between two concurrent
   * writes (P2034) is the same situation and gets the same 409.
   * Returns the number of deleted values.
   *
   * Verified against a real MongoDB replica set (Prisma 5): `equals` on a
   * string list compares the whole array, in order and case-sensitively
   * (prefix, superset, reordering and case changes match nothing); a throw
   * inside the interactive transaction rolls the update back. `equals: []`
   * matches neither a missing field nor `null`, and Prisma has no `isSet`
   * for scalar lists, although Prisma reads both as `[]`. So for an empty
   * `expected` a missing field is first back-filled with `[]` (the value
   * Prisma already reports, so no visible change) and the filter matches
   * `[]` or `null`.
   */
  private async writeIfUnchanged(
    collection: 'projects' | 'brands',
    id: string,
    expected: string[],
    update: (
      tx: Prisma.TransactionClient,
      matchesExpected: Prisma.ProjectWhereInput & Prisma.BrandWhereInput
    ) => Promise<{ count: number }>,
    deleteRemoved:
      | ((tx: Prisma.TransactionClient) => Promise<{ count: number }>)
      | null
  ): Promise<number> {
    let matchesExpected: Prisma.ProjectWhereInput & Prisma.BrandWhereInput
    if (expected.length === 0) {
      await this.prisma.$runCommandRaw({
        update: collection,
        updates: [
          {
            q: { _id: { $oid: id }, languages: { $exists: false } },
            u: { $set: { languages: [] } },
          },
        ],
      })
      matchesExpected = {
        OR: [{ languages: { equals: [] } }, { languages: { equals: null } }],
      }
    } else {
      matchesExpected = { languages: { equals: expected } }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const written = await update(tx, matchesExpected)
        if (written.count === 0) {
          throw new ConflictException(STALE_LANGUAGES_MESSAGE)
        }
        if (!deleteRemoved) return 0
        const deleted = await deleteRemoved(tx)
        return deleted.count
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(STALE_LANGUAGES_MESSAGE)
      }
      throw error
    }
  }

  private async loadProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        organizationId: true,
        languages: true,
        namespaces: true,
      },
    })
    if (!project) throw new NotFoundException('Project not found')
    return project
  }

  /** `language` is only set when exactly one language was added or removed. */
  private recordLanguagesChanged(
    organizationId: string,
    projectId: string,
    before: string[],
    after: string[]
  ) {
    const touched = [
      ...before.filter((l) => !after.includes(l)),
      ...after.filter((l) => !before.includes(l)),
    ]
    const change: TranslationChange = { action: 'languages_changed' }
    if (touched.length === 1) change.language = touched[0]
    this.record(organizationId, projectId, change)
  }

  private record(
    organizationId: string,
    projectId: string,
    change: TranslationChange
  ) {
    void this.changes.recordChange({
      organizationId,
      projectId,
      changes: [change],
    })
  }
}
