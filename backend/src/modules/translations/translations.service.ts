import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../../shared/prisma.service'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { ChangeEventsService } from '../change-events/change-events.service'
import { TranslationChange } from '../change-events/change-events.types'
import {
  DEFAULT_NAMESPACE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SCOPE,
  isValidKey,
  MAX_PAGE_SIZE,
  MAX_VALUE_LENGTH,
} from './limits'
import {
  auditKeyAction,
  isUniqueViolation,
  KeyRecord,
  loadBrand,
  loadKey,
  loadProject,
  recordKeyChange,
} from './translation-context'
import { findKeyConflict } from './translation-tree'

export interface TableCell {
  value: string | null
  /** true, wenn der Text vom Standardtext geerbt ist (nur nach `setValue` einer Brand-Zelle). */
  inherited: boolean
}
export interface TableRow {
  keyId: string
  key: string
  description: string | null
  /** true: the key can neither be renamed nor deleted until it is unlocked. */
  locked: boolean
  /** Standardtexte je Spalte; `inherited` ist hier immer false. */
  values: Record<string, TableCell>
  /** brandId -> Sprache -> eigener Text. Nur Brands mit mindestens einem Eintrag. */
  overrides: Record<string, Record<string, string>>
}
export interface TranslationTable {
  languages: string[]
  namespaces: string[]
  rows: TableRow[]
  total: number
  page: number
  pageSize: number
}
export interface TableQuery {
  namespace?: string
  search?: string
  missingOnly?: boolean
  page?: number
  pageSize?: number
}

const MISSING: TableCell = { value: null, inherited: false }

function keySummary(key: { id: string; namespace: string; key: string }) {
  return { id: key.id, namespace: key.namespace, key: key.key }
}

@Injectable()
export class TranslationsService {
  private readonly logger = new Logger(TranslationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ChangeEventsService,
    private readonly auditLogs: AuditLogsService
  ) {}

  /**
   * One page of the translations table (row = key, column = language): the
   * default texts plus the overrides of all brands.
   */
  async getTable(
    projectId: string,
    query: TableQuery
  ): Promise<TranslationTable> {
    const project = await this.loadProject(projectId)
    const namespace = this.resolveNamespace(project, query.namespace)

    // Query 1: all keys of the namespace.
    const keys = await this.prisma.translationKey.findMany({
      where: { projectId, namespace },
      select: { id: true, key: true, description: true, locked: true },
      orderBy: { key: 'asc' },
    })
    // Query 2: the brands (only in MULTI projects).
    const brands =
      project.type === 'MULTI'
        ? await this.prisma.brand.findMany({
            where: { projectId },
            select: { id: true, name: true, languages: true },
            orderBy: { name: 'asc' },
          })
        : []
    const languages = [...project.languages]
    for (const brand of brands) {
      for (const language of brand.languages) {
        if (!languages.includes(language)) languages.push(language)
      }
    }
    // Query 3: default texts and brand overrides of those keys.
    const values =
      keys.length === 0 || languages.length === 0
        ? []
        : await this.prisma.translationValue.findMany({
            where: {
              keyId: { in: keys.map((k) => k.id) },
              language: { in: languages },
              scope: { in: [DEFAULT_SCOPE, ...brands.map((b) => b.id)] },
            },
            select: { keyId: true, language: true, scope: true, value: true },
          })

    // keyId -> scope -> language -> text
    const texts = new Map<string, Map<string, Map<string, string>>>()
    for (const v of values) {
      let byScope = texts.get(v.keyId)
      if (!byScope) {
        byScope = new Map()
        texts.set(v.keyId, byScope)
      }
      let byLanguage = byScope.get(v.scope)
      if (!byLanguage) {
        byLanguage = new Map()
        byScope.set(v.scope, byLanguage)
      }
      byLanguage.set(v.language, v.value)
    }

    const search = query.search?.trim().toLowerCase() ?? ''
    const rows: TableRow[] = []
    for (const k of keys) {
      const byScope = texts.get(k.id)
      const standard = byScope?.get(DEFAULT_SCOPE)
      const cells: Record<string, TableCell> = {}
      for (const language of languages) {
        const text = project.languages.includes(language)
          ? standard?.get(language)
          : undefined
        cells[language] =
          text !== undefined
            ? { value: text, inherited: false }
            : { ...MISSING }
      }
      const overrides: Record<string, Record<string, string>> = {}
      for (const brand of brands) {
        const own = byScope?.get(brand.id)
        if (!own) continue
        const kept: Record<string, string> = {}
        for (const language of brand.languages) {
          const text = own.get(language)
          if (text !== undefined) kept[language] = text
        }
        if (Object.keys(kept).length > 0) overrides[brand.id] = kept
      }

      if (
        query.missingOnly &&
        !project.languages.some((l) => cells[l].value === null)
      ) {
        continue
      }
      if (
        search &&
        !k.key.toLowerCase().includes(search) &&
        !Object.values(cells).some((c) =>
          c.value?.toLowerCase().includes(search)
        ) &&
        !Object.values(overrides).some((own) =>
          Object.values(own).some((t) => t.toLowerCase().includes(search))
        )
      ) {
        continue
      }
      rows.push({
        keyId: k.id,
        key: k.key,
        description: k.description ?? null,
        locked: k.locked === true,
        values: cells,
        overrides,
      })
    }
    rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE))
    )
    const page = Math.max(1, Math.floor(query.page ?? 1))
    const start = (page - 1) * pageSize
    return {
      languages,
      namespaces: project.namespaces,
      rows: rows.slice(start, start + pageSize),
      total: rows.length,
      page,
      pageSize,
    }
  }

  async createKey(
    projectId: string,
    userId: string,
    dto: { namespace?: string; key: string; description?: string }
  ): Promise<{ id: string; namespace: string; key: string }> {
    const project = await this.loadProject(projectId)
    const namespace = this.resolveNamespace(project, dto.namespace)
    this.assertValidKey(dto.key)
    await this.assertNoKeyConflict(projectId, namespace, dto.key)

    let created: KeyRecord
    try {
      created = await this.prisma.translationKey.create({
        data: {
          projectId,
          organizationId: project.organizationId,
          namespace,
          key: dto.key,
          description: dto.description || null,
          createdById: userId,
        },
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw this.duplicate(dto.key)
      throw error
    }

    this.recordKeyChange(created, 'created')
    await this.audit('translation.key_created', created, userId, undefined, {
      namespace,
      key: created.key,
      description: created.description ?? null,
    })
    return keySummary(created)
  }

  async updateKey(
    keyId: string,
    userId: string,
    dto: { key?: string; description?: string | null }
  ): Promise<{ id: string; namespace: string; key: string }> {
    const current = await this.loadKey(keyId)
    const data: { key?: string; description?: string | null } = {}

    if (dto.key !== undefined && dto.key !== current.key) {
      this.assertUnlocked(current, 'renamed')
      this.assertValidKey(dto.key)
      await this.assertNoKeyConflict(
        current.projectId,
        current.namespace,
        dto.key,
        current.id
      )
      data.key = dto.key
    }
    if (dto.description !== undefined) {
      const description = dto.description || null
      if (description !== (current.description ?? null)) {
        data.description = description
      }
    }
    if (Object.keys(data).length === 0) return keySummary(current)

    let updated: KeyRecord
    try {
      updated = await this.prisma.translationKey.update({
        where: { id: keyId },
        data,
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw this.duplicate(data.key ?? '')
      throw error
    }

    this.recordKeyChange(updated, 'updated')
    await this.audit(
      'translation.key_updated',
      updated,
      userId,
      { key: current.key, description: current.description ?? null },
      { key: updated.key, description: updated.description ?? null }
    )
    return keySummary(updated)
  }

  async deleteKey(keyId: string, userId: string): Promise<void> {
    const key = await this.loadKey(keyId)
    this.assertUnlocked(key, 'deleted')
    // Values are deleted explicitly instead of relying on Prisma's emulated cascade.
    await this.prisma.$transaction([
      this.prisma.translationValue.deleteMany({ where: { keyId } }),
      this.prisma.translationKey.delete({ where: { id: keyId } }),
    ])

    this.recordKeyChange(key, 'deleted')
    await this.audit('translation.key_deleted', key, userId, {
      namespace: key.namespace,
      key: key.key,
      description: key.description ?? null,
    })
  }

  /**
   * Locks or unlocks a key. A locked key can neither be renamed nor deleted;
   * its texts and its description stay editable.
   */
  async setKeyLocked(
    keyId: string,
    userId: string,
    locked: boolean
  ): Promise<{ id: string; namespace: string; key: string; locked: boolean }> {
    const current = await this.loadKey(keyId)
    if ((current.locked === true) === locked) {
      return { ...keySummary(current), locked }
    }
    const updated: KeyRecord = await this.prisma.translationKey.update({
      where: { id: keyId },
      data: { locked },
    })
    await this.audit(
      locked ? 'translation.key_locked' : 'translation.key_unlocked',
      updated,
      userId,
      { key: updated.key, locked: !locked },
      { key: updated.key, locked }
    )
    return { ...keySummary(updated), locked }
  }

  /** Writes one cell; `''` removes the view's text and returns the cell valid afterwards. */
  async setValue(
    keyId: string,
    userId: string,
    dto: {
      language: string
      brandId?: string
      value: string
    }
  ): Promise<TableCell> {
    const key = await this.loadKey(keyId)
    const project = await this.loadProject(key.projectId)
    const view = await this.resolveView(project, dto.brandId)
    if (!view.languages.includes(dto.language)) {
      throw new BadRequestException(
        `Language "${dto.language}" is not enabled for this view`
      )
    }
    if (typeof dto.value !== 'string' || dto.value.length > MAX_VALUE_LENGTH) {
      throw new BadRequestException('Invalid value')
    }

    const scope = view.brandId ?? DEFAULT_SCOPE
    const cellId = { keyId, language: dto.language, scope }
    const ref = { language: dto.language, scope }
    const existing = await this.prisma.translationValue.findUnique({
      where: { keyId_language_scope: cellId },
    })

    if (dto.value === '') {
      const { count } = await this.prisma.translationValue.deleteMany({
        where: cellId,
      })
      if (count > 0) {
        this.recordValueChange(key, dto.language, 'deleted')
        await this.audit(
          'translation.value_deleted',
          key,
          userId,
          existing ? { ...ref, value: existing.value } : ref,
          ref
        )
      }
      if (!view.brandId || !project.languages.includes(dto.language)) {
        return { ...MISSING }
      }
      const standard = await this.prisma.translationValue.findUnique({
        where: {
          keyId_language_scope: {
            ...cellId,
            scope: DEFAULT_SCOPE,
          },
        },
      })
      return standard
        ? { value: standard.value, inherited: true }
        : { ...MISSING }
    }

    if (existing?.value === dto.value) {
      return { value: dto.value, inherited: false }
    }

    const write = () =>
      this.prisma.translationValue.upsert({
        where: { keyId_language_scope: cellId },
        create: {
          ...cellId,
          projectId: key.projectId,
          value: dto.value,
          updatedById: userId,
        },
        update: { value: dto.value, updatedById: userId },
      })
    try {
      await write()
    } catch (error) {
      // Two concurrent first writes of the same cell: the loser retries as an update.
      if (!isUniqueViolation(error)) throw error
      await write()
    }

    this.recordValueChange(key, dto.language, 'updated')
    await this.audit(
      'translation.value_updated',
      key,
      userId,
      existing ? { ...ref, value: existing.value } : undefined,
      { ...ref, value: dto.value }
    )
    return { value: dto.value, inherited: false }
  }

  private loadProject(projectId: string) {
    return loadProject(this.prisma, projectId)
  }

  private loadKey(keyId: string): Promise<KeyRecord> {
    return loadKey(this.prisma, keyId)
  }

  private resolveNamespace(
    project: { namespaces: string[] },
    namespace: string | undefined
  ): string {
    const resolved = namespace ?? DEFAULT_NAMESPACE
    if (!project.namespaces.includes(resolved)) {
      throw new BadRequestException(`Unknown namespace "${resolved}"`)
    }
    return resolved
  }

  /** Columns and stored scopes of the default view or of one brand's view. */
  private async resolveView(
    project: { id: string; type: string; languages: string[] },
    brandId: string | undefined
  ): Promise<{ languages: string[]; scopes: string[]; brandId?: string }> {
    if (!brandId) {
      return { languages: project.languages, scopes: [DEFAULT_SCOPE] }
    }
    const brand = await loadBrand(this.prisma, project, brandId)
    return {
      languages: brand.languages,
      scopes: [DEFAULT_SCOPE, brandId],
      brandId,
    }
  }

  private assertUnlocked(key: KeyRecord, action: 'renamed' | 'deleted') {
    if (key.locked === true) {
      throw new ConflictException({
        message: `Key "${key.key}" is locked and cannot be ${action}. Unlock it in the web interface first.`,
        code: 'key_locked',
      })
    }
  }

  private assertValidKey(key: string) {
    if (!isValidKey(key)) throw new BadRequestException('Invalid key')
  }

  /** Duplicate or leaf/parent conflict with any other key of the namespace. */
  private async assertNoKeyConflict(
    projectId: string,
    namespace: string,
    key: string,
    excludeId?: string
  ) {
    const others = await this.prisma.translationKey.findMany({
      where: {
        projectId,
        namespace,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { key: true },
    })
    const existing = others.map((k) => k.key)
    if (existing.includes(key)) throw this.duplicate(key)
    const conflict = findKeyConflict([key], existing)
    if (conflict) {
      throw new ConflictException(
        `Key "${key}" conflicts with existing key "${conflict.conflictsWith}"`
      )
    }
  }

  private duplicate(key: string) {
    return new ConflictException(`Key "${key}" already exists`)
  }

  private recordKeyChange(
    key: KeyRecord,
    action: 'created' | 'updated' | 'deleted'
  ) {
    this.recordChange(key, {
      key: key.key,
      namespace: key.namespace,
      action,
    })
  }

  private recordValueChange(
    key: KeyRecord,
    language: string,
    action: 'updated' | 'deleted'
  ) {
    this.recordChange(key, {
      key: key.key,
      namespace: key.namespace,
      language,
      action,
    })
  }

  private recordChange(key: KeyRecord, change: TranslationChange) {
    recordKeyChange(this.changes, key, change)
  }

  private audit(
    action: string,
    key: KeyRecord,
    userId: string,
    oldValues: Record<string, unknown> | undefined,
    newValues?: Record<string, unknown>
  ) {
    return auditKeyAction(
      this.auditLogs,
      this.logger,
      action,
      key,
      userId,
      oldValues,
      newValues
    )
  }
}
