import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { PrismaService } from '../../shared/prisma.service'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { writeAudit } from '../audit-logs/write-audit'
import { ChangeEventsService } from '../change-events/change-events.service'
import {
  DEFAULT_NAMESPACE,
  DEFAULT_SCOPE,
  MAX_VALUE_LENGTH,
} from '../translations/limits'
import {
  isUniqueViolation,
  loadBrand,
  loadProject,
} from '../translations/translation-context'
import { AI_DISABLED_CODE } from './ai-translation.constants'
import {
  AiTranslationUnavailableError,
  AiTranslator,
  AiUnavailableReason,
  TranslateItem,
} from './ai-translator'
import { ApplyDto } from './dto/apply.dto'
import {
  DEFAULT_PREVIEW_LIMIT,
  PreviewMissingDto,
} from './dto/preview-missing.dto'
import { SuggestDto } from './dto/suggest.dto'
import { samePlaceholders } from './placeholders'

export interface Suggestion {
  keyId: string
  value: string
  placeholderMismatch: boolean
}

export interface SuggestResult {
  suggestions: Suggestion[]
  skipped: { keyId: string; reason: 'no_source' }[]
}

export interface PreviewMissingResult {
  languages: {
    language: string
    remaining: number
    suggestions: {
      keyId: string
      key: string
      source: string
      value: string
      placeholderMismatch: boolean
    }[]
  }[]
}

export interface ApplyResult {
  written: number
  skippedExisting: number
}

interface SourcedKey {
  id: string
  key: string
  description: string | null
  text: string
}

function unavailable(reason: AiUnavailableReason): HttpException {
  switch (reason) {
    case 'disabled':
      return new ServiceUnavailableException({
        message: 'AI translation is not configured',
        error: 'Service Unavailable',
        code: AI_DISABLED_CODE,
      })
    case 'auth':
      return new ServiceUnavailableException({
        message: 'The AI provider rejected the configured credentials',
        error: 'Service Unavailable',
        code: 'ai_translation_auth',
      })
    case 'config':
      return new ServiceUnavailableException({
        message: 'AI translation is not set up correctly',
        error: 'Service Unavailable',
        code: 'ai_translation_config',
      })
    case 'rate_limit':
      return new HttpException(
        {
          message: 'The AI provider rate limit was reached, try again later',
          error: 'Too Many Requests',
          code: 'ai_translation_rate_limit',
        },
        429
      )
    default:
      return new BadGatewayException({
        message: 'The AI translation failed',
        error: 'Bad Gateway',
        code: 'ai_translation_failed',
      })
  }
}

/** Produces translation suggestions (never saved) and applies confirmed ones (never overwriting). */
@Injectable()
export class AiTranslationService {
  private readonly logger = new Logger(AiTranslationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly translator: AiTranslator,
    private readonly changes: ChangeEventsService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async suggest(projectId: string, dto: SuggestDto): Promise<SuggestResult> {
    this.assertEnabled()
    if (dto.sourceLanguage === dto.targetLanguage) {
      throw new BadRequestException(
        'Source and target language must be different'
      )
    }
    const project = await loadProject(this.prisma, projectId)
    const brand = dto.brandId
      ? await loadBrand(this.prisma, project, dto.brandId)
      : null

    const targetLanguages = brand ? brand.languages : project.languages
    if (!targetLanguages.includes(dto.targetLanguage)) {
      throw new BadRequestException(
        `Language "${dto.targetLanguage}" is not enabled for this view`
      )
    }
    const sourceIsProjectLanguage = project.languages.includes(
      dto.sourceLanguage
    )
    if (
      !sourceIsProjectLanguage &&
      !(brand && brand.languages.includes(dto.sourceLanguage))
    ) {
      throw new BadRequestException(
        `Language "${dto.sourceLanguage}" is not enabled for this view`
      )
    }

    const keyIds = [...new Set(dto.keyIds)]
    const keys = await this.loadProjectKeys(projectId, keyIds)

    const scopes = brand ? [DEFAULT_SCOPE, brand.id] : [DEFAULT_SCOPE]
    const rows = await this.prisma.translationValue.findMany({
      where: {
        keyId: { in: keyIds },
        language: dto.sourceLanguage,
        scope: { in: scopes },
      },
      select: { keyId: true, scope: true, value: true },
    })
    const sources = new Map<string, string>()
    for (const keyId of keyIds) {
      const override = brand
        ? rows.find((row) => row.keyId === keyId && row.scope === brand.id)
        : undefined
      const standard = sourceIsProjectLanguage
        ? rows.find((row) => row.keyId === keyId && row.scope === DEFAULT_SCOPE)
        : undefined
      const text = override?.value
        ? override.value
        : standard?.value
          ? standard.value
          : null
      if (text !== null) sources.set(keyId, text)
    }

    const items: TranslateItem[] = []
    const skipped: SuggestResult['skipped'] = []
    for (const keyId of keyIds) {
      const text = sources.get(keyId)
      const record = keys.get(keyId)
      if (text === undefined || !record) {
        skipped.push({ keyId, reason: 'no_source' })
        continue
      }
      items.push({
        id: keyId,
        key: record.key,
        description: record.description,
        text,
      })
    }

    const translated = await this.translate(
      dto.sourceLanguage,
      dto.targetLanguage,
      items
    )
    const suggestions: Suggestion[] = []
    for (const item of items) {
      const value = translated.get(item.id)
      if (value === undefined) continue
      suggestions.push({
        keyId: item.id,
        value,
        placeholderMismatch: !samePlaceholders(item.text, value),
      })
    }
    return { suggestions, skipped }
  }

  async previewMissing(
    projectId: string,
    dto: PreviewMissingDto
  ): Promise<PreviewMissingResult> {
    this.assertEnabled()
    const project = await loadProject(this.prisma, projectId)
    const targets = [...new Set(dto.targetLanguages)]
    if (!project.languages.includes(dto.sourceLanguage)) {
      throw new BadRequestException(
        `Language "${dto.sourceLanguage}" is not a project language`
      )
    }
    for (const language of targets) {
      if (!project.languages.includes(language)) {
        throw new BadRequestException(
          `Language "${language}" is not a project language`
        )
      }
    }
    if (targets.includes(dto.sourceLanguage)) {
      throw new BadRequestException(
        'The source language must not be one of the target languages'
      )
    }

    const limit = dto.limit ?? DEFAULT_PREVIEW_LIMIT
    const keys = (
      await this.prisma.translationKey.findMany({
        where: {
          projectId,
          namespace: dto.namespace ?? DEFAULT_NAMESPACE,
        },
        select: { id: true, key: true, description: true },
      })
    ).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

    const rows = await this.prisma.translationValue.findMany({
      where: {
        projectId,
        scope: DEFAULT_SCOPE,
        language: { in: [dto.sourceLanguage, ...targets] },
      },
      select: { keyId: true, language: true, value: true },
    })
    const sourceByKey = new Map<string, string>()
    const existing = new Set<string>()
    for (const row of rows) {
      if (row.language === dto.sourceLanguage) {
        if (row.value !== '') sourceByKey.set(row.keyId, row.value)
      } else {
        existing.add(`${row.language}\u0000${row.keyId}`)
      }
    }

    const languages: PreviewMissingResult['languages'] = []
    for (const language of targets) {
      const missing: SourcedKey[] = []
      for (const record of keys) {
        const text = sourceByKey.get(record.id)
        if (text === undefined) continue
        if (existing.has(`${language}\u0000${record.id}`)) continue
        missing.push({ ...record, text })
      }
      const batch = missing.slice(0, limit)
      const translated = await this.translate(
        dto.sourceLanguage,
        language,
        batch.map((item) => ({
          id: item.id,
          key: item.key,
          description: item.description,
          text: item.text,
        }))
      )
      languages.push({
        language,
        remaining: missing.length - batch.length,
        suggestions: batch.flatMap((item) => {
          const value = translated.get(item.id)
          if (value === undefined) return []
          return [
            {
              keyId: item.id,
              key: item.key,
              source: item.text,
              value,
              placeholderMismatch: !samePlaceholders(item.text, value),
            },
          ]
        }),
      })
    }
    return { languages }
  }

  /** Writes the confirmed texts that do not exist yet; never overwrites. */
  async apply(
    projectId: string,
    userId: string,
    dto: ApplyDto
  ): Promise<ApplyResult> {
    const project = await loadProject(this.prisma, projectId)
    const brand = dto.brandId
      ? await loadBrand(this.prisma, project, dto.brandId)
      : null
    const viewLanguages = brand ? brand.languages : project.languages
    if (!viewLanguages.includes(dto.targetLanguage)) {
      throw new BadRequestException(
        `Language "${dto.targetLanguage}" is not enabled for this view`
      )
    }

    const seen = new Set<string>()
    for (const entry of dto.values) {
      if (typeof entry.value !== 'string' || entry.value.trim() === '') {
        throw new BadRequestException('Values must not be empty')
      }
      if (entry.value.length > MAX_VALUE_LENGTH) {
        throw new BadRequestException(
          `Values must not be longer than ${MAX_VALUE_LENGTH} characters`
        )
      }
      if (seen.has(entry.keyId)) {
        throw new BadRequestException('Each key may appear only once')
      }
      seen.add(entry.keyId)
    }
    const keyIds = [...seen]
    await this.loadProjectKeys(projectId, keyIds)

    const scope = brand ? brand.id : DEFAULT_SCOPE
    const existingRows = await this.prisma.translationValue.findMany({
      where: {
        keyId: { in: keyIds },
        language: dto.targetLanguage,
        scope,
      },
      select: { keyId: true },
    })
    const existing = new Set(existingRows.map((row) => row.keyId))

    let written = 0
    let skippedExisting = 0
    for (const entry of dto.values) {
      if (existing.has(entry.keyId)) {
        skippedExisting++
        continue
      }
      try {
        await this.prisma.translationValue.create({
          data: {
            keyId: entry.keyId,
            projectId,
            language: dto.targetLanguage,
            scope,
            value: entry.value,
            updatedById: userId,
          },
        })
        written++
      } catch (error) {
        // A concurrent write won: keep its text.
        if (!isUniqueViolation(error)) throw error
        skippedExisting++
      }
    }

    if (written > 0) {
      void this.changes.recordChange({
        organizationId: project.organizationId,
        projectId,
        changes: [{ language: dto.targetLanguage, action: 'ai_translated' }],
      })
      await writeAudit(this.auditLogs, this.logger, {
        action: 'translation.ai_translated',
        entityType: 'Project',
        entityId: projectId,
        userId,
        organizationId: project.organizationId,
        projectId,
        newValues: { language: dto.targetLanguage, scope, count: written },
      })
    }
    return { written, skippedExisting }
  }

  private assertEnabled() {
    if (!this.translator.isEnabled()) throw unavailable('disabled')
  }

  /** All keys must belong to the project, otherwise 404 for the whole request. */
  private async loadProjectKeys(projectId: string, keyIds: string[]) {
    const keys = await this.prisma.translationKey.findMany({
      where: { projectId, id: { in: keyIds } },
      select: { id: true, key: true, description: true },
    })
    if (keys.length !== keyIds.length) {
      throw new NotFoundException('Translation key not found')
    }
    return new Map(keys.map((record) => [record.id, record]))
  }

  private async translate(
    sourceLanguage: string,
    targetLanguage: string,
    items: TranslateItem[]
  ): Promise<Map<string, string>> {
    if (items.length === 0) return new Map()
    try {
      const result = await this.translator.translate({
        sourceLanguage,
        targetLanguage,
        items,
      })
      // Over-long suggestions are dropped like entries the model omitted.
      return new Map(
        result
          .filter((entry) => entry.text.length <= MAX_VALUE_LENGTH)
          .map((entry) => [entry.id, entry.text])
      )
    } catch (error) {
      if (error instanceof AiTranslationUnavailableError) {
        throw unavailable(error.reason)
      }
      throw error
    }
  }
}
