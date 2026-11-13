import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { OrganizationRole } from '@prisma/client'
import { hasRole } from '../../shared/access/access.service'
import { PrismaService } from '../../shared/prisma.service'
import { AiTranslationService } from '../ai-translation/ai-translation.service'
import { AiTranslator } from '../ai-translation/ai-translator'
import {
  DEFAULT_NAMESPACE,
  DEFAULT_SCOPE,
  isValidKey,
  LANGUAGE_PATTERN,
  MAX_DESCRIPTION_LENGTH,
  MAX_KEY_LENGTH,
  MAX_VALUE_LENGTH,
} from '../translations/limits'
import { TranslationSettingsService } from '../translations/translation-settings.service'
import {
  TableRow,
  TranslationsService,
} from '../translations/translations.service'
import {
  MCP_AI_CALLS_PER_WINDOW,
  McpAiRateLimiter,
} from './mcp-ai-rate-limiter'
import { McpContext } from './mcp-key.resolver'

/** An expected tool failure; its message is shown to the agent. */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}

export const MCP_PAGE_SIZE = 50
export const MAX_SET_TRANSLATIONS_ENTRIES = 50
export const MAX_TRANSLATE_KEYS = 40

const APPLY_FAILED_MESSAGE =
  'Storing the suggestions failed, and some of them may already have been stored. Check the affected keys with get_key or list_keys and store the missing texts from "suggestions" with set_translations.'

const AI_LIMIT_MESSAGE = `The AI translation limit of ${MCP_AI_CALLS_PER_WINDOW} calls per minute was reached. Nothing was translated or written. Try again in about a minute, or translate the texts yourself and store them with set_translations.`

const AI_DISABLED_MESSAGE =
  'AI translation is not enabled on this instance. Translate the texts yourself and store them with set_translations.'

/** Messages for the error codes of the ai-translation module. */
const AI_ERROR_MESSAGES: Record<string, string> = {
  ai_translation_disabled: AI_DISABLED_MESSAGE,
  ai_translation_auth:
    'AI translation is not set up correctly on this instance (the AI provider rejected the credentials). Nothing was written. Ask an administrator to check the setup, or translate the texts yourself and store them with set_translations.',
  ai_translation_config:
    'AI translation is not set up correctly on this instance (invalid configuration). Nothing was written. Ask an administrator to check the setup, or translate the texts yourself and store them with set_translations.',
  ai_translation_rate_limit:
    'The AI provider is busy (rate limit reached). Nothing was written. Try again in a minute, or translate the texts yourself and store them with set_translations.',
  ai_translation_failed:
    'The AI translation failed or was refused by the AI provider. Nothing was written. Try again with fewer keys, or translate the texts yourself and store them with set_translations.',
}

/** One key as the agent sees it: default texts of the project languages plus brand overrides. */
export interface McpKeyEntry {
  key: string
  description: string | null
  /** true: the key can neither be renamed nor deleted (unlocking is done in the web interface). */
  locked: boolean
  /** Default texts by language; only languages that have a text. */
  values: Record<string, string>
  /** Project languages without a default text. */
  missing: string[]
  /** brandKey -> language -> own text of the brand. */
  brandOverrides: Record<string, Record<string, string>>
}

interface ProjectView {
  id: string
  key: string
  name: string
  type: string
  languages: string[]
  namespaces: string[]
}

interface BrandView {
  id: string
  key: string
  name: string
  languages: string[]
}

/** A translation proposal for one key of the standard texts. */
interface Proposal {
  keyId: string
  key: string
  source: string
  value: string
  mismatch: boolean
}

interface FoundKey {
  id: string
  namespace: string
  key: string
  description: string | null
  locked: boolean | null
}

/**
 * The MCP tools for one project. The TranslationsService methods assume the
 * caller checked the role, so every tool checks `ctx.role` itself and binds
 * every lookup to `ctx.projectId`.
 */
@Injectable()
export class McpToolsService {
  private readonly logger = new Logger(McpToolsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly translations: TranslationsService,
    private readonly ai: AiTranslator,
    private readonly aiTranslation: AiTranslationService,
    private readonly aiLimiter: McpAiRateLimiter,
    private readonly settings: TranslationSettingsService
  ) {}

  async getProject(ctx: McpContext) {
    this.requireRole(ctx, 'VIEWER')
    const project = await this.loadProject(ctx)
    const brands = await this.loadBrands(ctx, project)
    return {
      project: { key: project.key, name: project.name, type: project.type },
      languages: project.languages,
      namespaces: project.namespaces,
      brands: brands.map((b) => ({
        key: b.key,
        name: b.name,
        languages: b.languages,
      })),
      aiTranslationEnabled: this.ai.isEnabled(),
      role: ctx.role,
      canWrite: hasRole(ctx.role, 'MEMBER'),
    }
  }

  async listKeys(
    ctx: McpContext,
    input: {
      namespace?: string
      search?: string
      missingOnly?: boolean
      page?: number
    }
  ) {
    this.requireRole(ctx, 'VIEWER')
    const project = await this.loadProject(ctx)
    const namespace = this.resolveNamespace(project, input?.namespace)
    const brands = await this.loadBrands(ctx, project)
    const table = await this.run(() =>
      this.translations.getTable(ctx.projectId, {
        namespace,
        search: input?.search,
        missingOnly: input?.missingOnly,
        page: input?.page,
        pageSize: MCP_PAGE_SIZE,
      })
    )
    return {
      keys: table.rows.map((row) => this.rowToEntry(row, project, brands)),
      total: table.total,
      page: table.page,
      pageSize: table.pageSize,
    }
  }

  async getKey(
    ctx: McpContext,
    input: { key: string; namespace?: string }
  ): Promise<McpKeyEntry> {
    this.requireRole(ctx, 'VIEWER')
    const project = await this.loadProject(ctx)
    const key = await this.findKey(ctx, project, input?.key, input?.namespace)
    const brands = await this.loadBrands(ctx, project)
    const texts = await this.prisma.translationValue.findMany({
      where: {
        keyId: key.id,
        projectId: ctx.projectId,
        scope: { in: [DEFAULT_SCOPE, ...brands.map((b) => b.id)] },
      },
      select: { language: true, scope: true, value: true },
    })

    const standard: Record<string, string> = {}
    const overrides: Record<string, Record<string, string>> = {}
    for (const text of texts) {
      if (text.scope === DEFAULT_SCOPE) {
        if (project.languages.includes(text.language)) {
          standard[text.language] = text.value
        }
        continue
      }
      const brand = brands.find((b) => b.id === text.scope)
      if (!brand?.languages.includes(text.language)) continue
      overrides[brand.key] ??= {}
      overrides[brand.key][text.language] = text.value
    }
    return this.toEntry(
      key.key,
      key.description,
      key.locked === true,
      standard,
      overrides,
      project
    )
  }

  async createKey(
    ctx: McpContext,
    input: {
      key: string
      namespace?: string
      description?: string
      values?: Record<string, string>
    }
  ) {
    this.requireRole(ctx, 'MEMBER')
    const project = await this.loadProject(ctx)
    const namespace = this.resolveNamespace(project, input?.namespace)
    this.assertValidKey(input?.key)
    this.assertValidDescription(input.description)
    // Validate every text before anything is created
    const values = Object.entries(input.values ?? {})
    for (const [language, text] of values) {
      this.checkText(
        `Key "${input.key}"`,
        language,
        text,
        project.languages,
        'this project'
      )
    }

    const created = await this.run(() =>
      this.translations.createKey(ctx.projectId, ctx.userId, {
        key: input.key,
        namespace,
        ...(input.description !== undefined && {
          description: input.description,
        }),
      })
    )
    const written: string[] = []
    for (const [language, value] of values) {
      try {
        await this.run(() =>
          this.translations.setValue(created.id, ctx.userId, {
            language,
            value,
          })
        )
      } catch (error) {
        throw this.partialFailure(
          error,
          `Key "${created.key}" was created, but ${written.length} of ${values.length} texts were written before the error`
        )
      }
      written.push(language)
    }
    return { key: created.key, namespace: created.namespace, written }
  }

  async updateKey(
    ctx: McpContext,
    input: {
      key: string
      namespace?: string
      newKey?: string
      description?: string
    }
  ) {
    this.requireRole(ctx, 'MEMBER')
    if (input?.newKey === undefined && input?.description === undefined) {
      throw new McpToolError('Provide newKey and/or description')
    }
    const project = await this.loadProject(ctx)
    const key = await this.findKey(ctx, project, input.key, input.namespace)
    if (input.newKey !== undefined) this.assertValidKey(input.newKey)
    this.assertValidDescription(input.description)

    const updated = await this.run(() =>
      this.translations.updateKey(key.id, ctx.userId, {
        ...(input.newKey !== undefined && { key: input.newKey }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
      })
    )
    return {
      key: updated.key,
      namespace: updated.namespace,
      description:
        input.description !== undefined
          ? input.description || null
          : (key.description ?? null),
    }
  }

  async setTranslations(
    ctx: McpContext,
    input: {
      namespace?: string
      brandKey?: string
      entries: { key: string; values: Record<string, string> }[]
    }
  ) {
    this.requireRole(ctx, 'MEMBER')
    const entries = Array.isArray(input?.entries) ? input.entries : []
    if (entries.length < 1 || entries.length > MAX_SET_TRANSLATIONS_ENTRIES) {
      throw new McpToolError(
        `Provide between 1 and ${MAX_SET_TRANSLATIONS_ENTRIES} entries (got ${entries.length}); split larger batches into several calls`
      )
    }
    const project = await this.loadProject(ctx)
    const namespace = this.resolveNamespace(project, input.namespace)

    let brand: BrandView | undefined
    if (input.brandKey !== undefined) {
      const brands = await this.loadBrands(ctx, project)
      brand = brands.find((b) => b.key === input.brandKey)
      if (!brand) {
        throw new McpToolError(
          project.type === 'MULTI'
            ? `Unknown brand "${input.brandKey}". Brands of this project: ${list(brands.map((b) => b.key))}`
            : `Unknown brand "${input.brandKey}": this project has no brands; omit brandKey`
        )
      }
    }
    const languages = brand ? brand.languages : project.languages
    const view = brand ? `brand "${brand.key}"` : 'this project'

    const seen = new Set<string>()
    entries.forEach((entry, i) => {
      if (seen.has(entry.key)) {
        throw new McpToolError(
          `Entry ${i + 1} ("${entry.key}"): duplicate key; list each key once`
        )
      }
      seen.add(entry.key)
    })

    const keys = await this.prisma.translationKey.findMany({
      where: { projectId: ctx.projectId, namespace, key: { in: [...seen] } },
      select: { id: true, key: true },
    })
    const idOf = new Map(keys.map((k) => [k.key, k.id]))

    // Validate everything first: on any error nothing is written
    entries.forEach((entry, i) => {
      const label = `Entry ${i + 1} ("${entry.key}")`
      if (!idOf.has(entry.key)) {
        throw new McpToolError(
          `${label}: key not found in namespace "${namespace}"; create it with create_key first`
        )
      }
      const texts = Object.entries(entry.values ?? {})
      if (texts.length === 0) {
        throw new McpToolError(`${label}: no texts given`)
      }
      for (const [language, text] of texts) {
        this.checkText(label, language, text, languages, view)
      }
    })

    const scope = brand?.id ?? DEFAULT_SCOPE
    const stored = await this.prisma.translationValue.findMany({
      where: {
        projectId: ctx.projectId,
        keyId: { in: [...idOf.values()] },
        scope,
        language: { in: languages },
      },
      select: { keyId: true, language: true, value: true },
    })
    const current = new Map(
      stored.map((v) => [`${v.keyId}\u0000${v.language}`, v.value])
    )

    let written = 0
    let unchanged = 0
    // Texts that differ from the stored ones, i.e. what this call writes
    const total = entries.reduce(
      (sum, entry) =>
        sum +
        Object.entries(entry.values).filter(
          ([language, value]) =>
            current.get(`${idOf.get(entry.key)}\u0000${language}`) !== value
        ).length,
      0
    )
    for (const entry of entries) {
      const keyId = idOf.get(entry.key) as string
      for (const [language, value] of Object.entries(entry.values)) {
        if (current.get(`${keyId}\u0000${language}`) === value) {
          unchanged++
          continue
        }
        try {
          await this.run(() =>
            this.translations.setValue(keyId, ctx.userId, {
              language,
              ...(brand && { brandId: brand.id }),
              value,
            })
          )
        } catch (error) {
          // Nothing written yet: the plain error says it all
          if (written === 0) throw error
          throw this.partialFailure(
            error,
            `${written} of ${total} texts were written before the error`
          )
        }
        written++
      }
    }
    return { written, unchanged }
  }

  async translateMissing(
    ctx: McpContext,
    input: {
      sourceLanguage: string
      targetLanguage: string
      namespace?: string
      keys?: string[]
      apply?: boolean
    }
  ) {
    this.requireRole(ctx, 'MEMBER')
    const project = await this.loadProject(ctx)
    const { sourceLanguage, targetLanguage } = input ?? {}
    for (const language of [sourceLanguage, targetLanguage]) {
      if (
        typeof language !== 'string' ||
        !project.languages.includes(language)
      ) {
        throw new McpToolError(
          `Unknown language "${language}". Languages of this project: ${list(project.languages)}`
        )
      }
    }
    if (sourceLanguage === targetLanguage) {
      throw new McpToolError('The source and target language must differ')
    }
    const namespace = this.resolveNamespace(project, input.namespace)
    let names: string[] | undefined
    if (input.keys !== undefined) {
      names = Array.isArray(input.keys) ? [...new Set(input.keys)] : []
      if (names.length < 1 || names.length > MAX_TRANSLATE_KEYS) {
        throw new McpToolError(
          `Provide between 1 and ${MAX_TRANSLATE_KEYS} keys (got ${names.length}), or omit keys to translate the next missing texts`
        )
      }
    }

    const { found, remaining } =
      names === undefined
        ? await this.proposeNextMissing(
            ctx,
            sourceLanguage,
            targetLanguage,
            namespace
          )
        : await this.proposeForKeys(
            ctx,
            sourceLanguage,
            targetLanguage,
            namespace,
            names
          )

    // A blank proposal is as good as none: never shown, never stored
    const usable = found.filter((f) => f.value.trim() !== '')
    const ready = usable.filter((f) => !f.mismatch)
    const needsReview = usable
      .filter((f) => f.mismatch)
      .map((f) => ({
        key: f.key,
        source: f.source,
        value: f.value,
        reason: 'placeholders' as const,
      }))

    let applied = 0
    let skippedExisting = 0
    let applyError: string | undefined
    if (input.apply === true && ready.length > 0) {
      try {
        const result = await this.run(() =>
          this.aiTranslation.apply(ctx.projectId, ctx.userId, {
            targetLanguage,
            values: ready.map((f) => ({ keyId: f.keyId, value: f.value })),
          })
        )
        applied = result.written
        skippedExisting = result.skippedExisting
      } catch (error) {
        // The paid suggestions are kept; the agent gets them with a note
        applyError = APPLY_FAILED_MESSAGE
        if (error instanceof McpToolError) {
          applyError += ` Reason: ${error.message}`
        } else {
          this.logger.error(
            `Storing AI suggestions failed: ${error instanceof Error ? error.name : typeof error}`
          )
        }
      }
    }
    return {
      suggestions: ready.map((f) => ({
        key: f.key,
        source: f.source,
        value: f.value,
      })),
      needsReview,
      applied,
      skippedExisting,
      remaining,
      ...(applyError !== undefined && { applyError }),
    }
  }

  /** The next missing standard texts of the target language, as the bulk preview picks them. */
  private async proposeNextMissing(
    ctx: McpContext,
    sourceLanguage: string,
    targetLanguage: string,
    namespace: string
  ): Promise<{ found: Proposal[]; remaining: number }> {
    this.consumeAiBudget(ctx)
    const preview = await this.runAi(() =>
      this.aiTranslation.previewMissing(ctx.projectId, {
        sourceLanguage,
        targetLanguages: [targetLanguage],
        namespace,
        limit: MAX_TRANSLATE_KEYS,
      })
    )
    const entry = preview.languages[0]
    return {
      remaining: entry?.remaining ?? 0,
      found: (entry?.suggestions ?? []).map((s) => ({
        keyId: s.keyId,
        key: s.key,
        source: s.source,
        value: s.value,
        mismatch: s.placeholderMismatch,
      })),
    }
  }

  /** Exactly the named keys; those without source text or with a target text are left out. */
  private async proposeForKeys(
    ctx: McpContext,
    sourceLanguage: string,
    targetLanguage: string,
    namespace: string,
    names: string[]
  ): Promise<{ found: Proposal[]; remaining: number }> {
    const records = await this.prisma.translationKey.findMany({
      where: { projectId: ctx.projectId, namespace, key: { in: names } },
      select: { id: true, key: true },
    })
    const idOf = new Map(records.map((r) => [r.key, r.id]))
    const nameOf = new Map(records.map((r) => [r.id, r.key]))
    const unknown = names.filter((name) => !idOf.has(name))
    if (unknown.length > 0) {
      throw new McpToolError(
        `Unknown keys in namespace "${namespace}": ${unknown.map((k) => `"${k}"`).join(', ')}`
      )
    }
    const rows = await this.prisma.translationValue.findMany({
      where: {
        projectId: ctx.projectId,
        keyId: { in: [...idOf.values()] },
        scope: DEFAULT_SCOPE,
        language: { in: [sourceLanguage, targetLanguage] },
      },
      select: { keyId: true, language: true, value: true },
    })
    const sources = new Map<string, string>()
    const hasTarget = new Set<string>()
    for (const row of rows) {
      if (row.language === targetLanguage) hasTarget.add(row.keyId)
      else if (row.value.trim() !== '') sources.set(row.keyId, row.value)
    }
    const keyIds = [...idOf.values()].filter(
      (id) => sources.has(id) && !hasTarget.has(id)
    )
    if (keyIds.length === 0) return { found: [], remaining: 0 }

    this.consumeAiBudget(ctx)
    const result = await this.runAi(() =>
      this.aiTranslation.suggest(ctx.projectId, {
        sourceLanguage,
        targetLanguage,
        keyIds,
      })
    )
    return {
      remaining: 0,
      found: result.suggestions.map((s) => ({
        keyId: s.keyId,
        key: nameOf.get(s.keyId) as string,
        source: sources.get(s.keyId) as string,
        value: s.value,
        mismatch: s.placeholderMismatch,
      })),
    }
  }

  async deleteKey(
    ctx: McpContext,
    input: { key: string; namespace?: string; confirm?: boolean }
  ) {
    this.requireRole(ctx, 'ADMIN')
    const project = await this.loadProject(ctx)
    const key = await this.findKey(ctx, project, input?.key, input?.namespace)
    if (key.locked === true) {
      throw new McpToolError(
        `Key "${key.key}" is locked and cannot be deleted. Unlocking is done in the web interface.`
      )
    }
    if (input.confirm !== true) {
      const texts = await this.prisma.translationValue.count({
        where: { keyId: key.id, projectId: ctx.projectId },
      })
      return { wouldDelete: { key: key.key, texts } }
    }
    await this.run(() => this.translations.deleteKey(key.id, ctx.userId))
    return { deleted: true }
  }

  /**
   * Appends one language to the project's list, or to a brand's list with
   * brandKey. Only ever adds: removing a language deletes its texts and stays
   * in the web interface. The write is bound to the list read here, so a
   * concurrent change is reported instead of being overwritten.
   */
  async addLanguage(
    ctx: McpContext,
    input: { language: string; brandKey?: string }
  ) {
    this.requireRole(ctx, 'ADMIN')
    const language = input?.language
    if (typeof language !== 'string' || !LANGUAGE_PATTERN.test(language)) {
      throw new McpToolError(
        `Invalid language code "${language}": use a code such as "fr" or "pt-BR"`
      )
    }
    const project = await this.loadProject(ctx)

    let brand: BrandView | undefined
    if (input.brandKey !== undefined) {
      const brands = await this.loadBrands(ctx, project)
      brand = brands.find((b) => b.key === input.brandKey)
      if (!brand) {
        throw new McpToolError(
          project.type === 'MULTI'
            ? `Unknown brand "${input.brandKey}". Brands of this project: ${list(brands.map((b) => b.key))}`
            : `Unknown brand "${input.brandKey}": this project has no brands; omit brandKey`
        )
      }
    }
    const current = brand ? brand.languages : project.languages
    const target = brand ? { brandKey: brand.key } : {}
    if (current.includes(language)) {
      return { ...target, languages: current, added: false }
    }

    const next = [...current, language]
    const brandId = brand?.id
    const result = await this.run(async () => {
      try {
        return brandId
          ? await this.settings.setBrandLanguages(
              brandId,
              ctx.userId,
              next,
              current
            )
          : await this.settings.setProjectLanguages(
              ctx.projectId,
              ctx.userId,
              next,
              current
            )
      } catch (error) {
        if (error instanceof ConflictException) {
          throw new McpToolError(
            'The language list was changed in the meantime. Nothing was written; call get_project and try again.'
          )
        }
        throw error
      }
    })
    return { ...target, languages: result.languages, added: true }
  }

  /**
   * Counts a call to the paid AI translation against the user's budget (shared
   * by all keys of the user). Called after validation, right before the AI.
   */
  private consumeAiBudget(ctx: McpContext) {
    if (!this.aiLimiter.tryConsume(ctx.userId)) {
      throw new McpToolError(AI_LIMIT_MESSAGE)
    }
  }

  private requireRole(ctx: McpContext, min: OrganizationRole) {
    if (!hasRole(ctx.role, min)) {
      throw new McpToolError(
        `Your role ${ctx.role} does not allow this action; it requires ${min} or higher`
      )
    }
  }

  private async loadProject(ctx: McpContext): Promise<ProjectView> {
    const project = await this.prisma.project.findFirst({
      where: { id: ctx.projectId, organizationId: ctx.organizationId },
      select: {
        id: true,
        key: true,
        name: true,
        type: true,
        languages: true,
        namespaces: true,
      },
    })
    if (!project) throw new McpToolError('Project not found')
    return project
  }

  private async loadBrands(
    ctx: McpContext,
    project: ProjectView
  ): Promise<BrandView[]> {
    if (project.type !== 'MULTI') return []
    return this.prisma.brand.findMany({
      where: { projectId: ctx.projectId },
      select: { id: true, key: true, name: true, languages: true },
      orderBy: { name: 'asc' },
    })
  }

  private resolveNamespace(
    project: ProjectView,
    namespace: string | undefined
  ): string {
    const resolved = namespace ?? DEFAULT_NAMESPACE
    if (!project.namespaces.includes(resolved)) {
      throw new McpToolError(
        `Unknown namespace "${resolved}". Namespaces of this project: ${list(project.namespaces)}`
      )
    }
    return resolved
  }

  private async findKey(
    ctx: McpContext,
    project: ProjectView,
    key: string | undefined,
    namespace: string | undefined
  ): Promise<FoundKey> {
    const resolved = this.resolveNamespace(project, namespace)
    const found =
      typeof key === 'string' && key
        ? await this.prisma.translationKey.findFirst({
            where: { projectId: ctx.projectId, namespace: resolved, key },
            select: {
              id: true,
              namespace: true,
              key: true,
              description: true,
              locked: true,
            },
          })
        : null
    if (!found) {
      throw new McpToolError(
        `Key "${key}" not found in namespace "${resolved}" of this project`
      )
    }
    return found
  }

  private assertValidKey(key: string | undefined) {
    if (typeof key !== 'string' || !isValidKey(key)) {
      throw new McpToolError(
        `Invalid key "${key}": use 1-${MAX_KEY_LENGTH} characters in dot notation (e.g. "home.title"), without leading, trailing or double dots`
      )
    }
  }

  private assertValidDescription(description: string | undefined) {
    if (
      description !== undefined &&
      (typeof description !== 'string' ||
        description.length > MAX_DESCRIPTION_LENGTH)
    ) {
      throw new McpToolError(
        `The description must be a text of at most ${MAX_DESCRIPTION_LENGTH} characters`
      )
    }
  }

  /** One text of an input: language of the view, not empty, not too long. */
  private checkText(
    label: string,
    language: string,
    text: unknown,
    languages: string[],
    view: string
  ) {
    if (!languages.includes(language)) {
      throw new McpToolError(
        `${label}: language "${language}" is not a language of ${view}. Allowed languages: ${list(languages)}`
      )
    }
    if (typeof text !== 'string' || text.trim() === '') {
      throw new McpToolError(
        `${label}: the text for "${language}" is empty; leave out languages without a text`
      )
    }
    if (text.length > MAX_VALUE_LENGTH) {
      throw new McpToolError(
        `${label}: the text for "${language}" is longer than ${MAX_VALUE_LENGTH} characters`
      )
    }
  }

  private rowToEntry(
    row: TableRow,
    project: ProjectView,
    brands: BrandView[]
  ): McpKeyEntry {
    const standard: Record<string, string> = {}
    for (const language of project.languages) {
      const value = row.values[language]?.value
      if (value != null) standard[language] = value
    }
    const overrides: Record<string, Record<string, string>> = {}
    for (const [brandId, texts] of Object.entries(row.overrides)) {
      const brand = brands.find((b) => b.id === brandId)
      if (brand) overrides[brand.key] = { ...texts }
    }
    return this.toEntry(
      row.key,
      row.description,
      row.locked,
      standard,
      overrides,
      project
    )
  }

  private toEntry(
    key: string,
    description: string | null,
    locked: boolean,
    values: Record<string, string>,
    brandOverrides: Record<string, Record<string, string>>,
    project: ProjectView
  ): McpKeyEntry {
    return {
      key,
      description: description ?? null,
      locked,
      values,
      missing: project.languages.filter((l) => typeof values[l] !== 'string'),
      brandOverrides,
    }
  }

  /**
   * The error of a write that failed after earlier writes succeeded: tells the
   * agent what is already stored. Messages meant for agents are kept; anything
   * else is logged without its message (it can quote texts) and replaced by a
   * generic wording.
   */
  private partialFailure(error: unknown, progress: string): McpToolError {
    if (error instanceof McpToolError) {
      const reason = error.message.replace(/\.$/, '')
      return new McpToolError(`${reason}. ${progress}.`)
    }
    this.logger.error(
      `Writing texts failed: ${error instanceof Error ? error.name : typeof error}`
    )
    return new McpToolError(`Internal error while writing texts. ${progress}.`)
  }

  /** Like run(), plus the error codes of the ai-translation module. */
  private async runAi<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await this.run(fn)
    } catch (error) {
      if (error instanceof HttpException) {
        const response = error.getResponse()
        const code =
          typeof response === 'object'
            ? (response as { code?: unknown }).code
            : undefined
        const message =
          typeof code === 'string' ? AI_ERROR_MESSAGES[code] : undefined
        if (message) throw new McpToolError(message)
      }
      throw error
    }
  }

  /**
   * Maps the expected errors of the translation services to McpToolError.
   * Anything else is rethrown so runTool logs it and reports it generically.
   */
  private async run<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn()
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw new McpToolError(error.message)
      }
      throw error
    }
  }
}

function list(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '(none)'
}
