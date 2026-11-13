import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma.service'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { ChangeEventsService } from '../change-events/change-events.service'
import { DEFAULT_SCOPE } from './limits'
import {
  auditKeyAction,
  isUniqueViolation,
  KeyRecord,
  loadBrand,
  loadKey,
  loadProject,
  recordKeyChange,
} from './translation-context'
import { TableCell } from './translations.service'

interface LinkTarget {
  brandId: string
  language: string
}

interface LinkContext {
  key: KeyRecord
  projectLanguages: string[]
  cellId: { keyId: string; language: string; scope: string }
}

/** Links a brand text to the standard text (no override) or unlinks it (override). */
@Injectable()
export class TranslationLinkService {
  private readonly logger = new Logger(TranslationLinkService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ChangeEventsService,
    private readonly auditLogs: AuditLogsService
  ) {}

  /** Creates the override with the current standard text. */
  async unlink(
    keyId: string,
    userId: string,
    target: LinkTarget
  ): Promise<TableCell> {
    const { key, projectLanguages, cellId } = await this.resolve(keyId, target)
    const existing = await this.prisma.translationValue.findUnique({
      where: { keyId_language_scope: cellId },
    })
    if (existing) return { value: existing.value, inherited: false }

    const standard = await this.standardText(
      keyId,
      target.language,
      projectLanguages
    )
    if (standard === null) return { value: null, inherited: false }

    try {
      await this.prisma.translationValue.create({
        data: {
          ...cellId,
          projectId: key.projectId,
          value: standard,
          updatedById: userId,
        },
      })
    } catch (error) {
      // A concurrent unlink won: report its override, record nothing.
      if (!isUniqueViolation(error)) throw error
      const winner = await this.prisma.translationValue.findUnique({
        where: { keyId_language_scope: cellId },
      })
      if (!winner) throw error
      return { value: winner.value, inherited: false }
    }
    recordKeyChange(this.changes, key, {
      key: key.key,
      namespace: key.namespace,
      language: target.language,
      action: 'updated',
    })
    await auditKeyAction(
      this.auditLogs,
      this.logger,
      'translation.value_unlinked',
      key,
      userId,
      undefined,
      { language: target.language, scope: target.brandId, value: standard }
    )
    return { value: standard, inherited: false }
  }

  /** Deletes the override; the brand inherits the standard text again. */
  async link(
    keyId: string,
    userId: string,
    target: LinkTarget
  ): Promise<TableCell> {
    const { key, projectLanguages, cellId } = await this.resolve(keyId, target)
    const existing = await this.prisma.translationValue.findUnique({
      where: { keyId_language_scope: cellId },
    })
    if (existing) {
      const { count } = await this.prisma.translationValue.deleteMany({
        where: cellId,
      })
      if (count > 0) {
        recordKeyChange(this.changes, key, {
          key: key.key,
          namespace: key.namespace,
          language: target.language,
          action: 'deleted',
        })
        await auditKeyAction(
          this.auditLogs,
          this.logger,
          'translation.value_linked',
          key,
          userId,
          {
            language: target.language,
            scope: target.brandId,
            value: existing.value,
          },
          undefined
        )
      }
    }

    const standard = await this.standardText(
      keyId,
      target.language,
      projectLanguages
    )
    return standard === null
      ? { value: null, inherited: false }
      : { value: standard, inherited: true }
  }

  private async resolve(
    keyId: string,
    target: LinkTarget
  ): Promise<LinkContext> {
    const key = await loadKey(this.prisma, keyId)
    const project = await loadProject(this.prisma, key.projectId)
    const brand = await loadBrand(this.prisma, project, target.brandId)
    if (!brand.languages.includes(target.language)) {
      throw new BadRequestException(
        `Language "${target.language}" is not enabled for this view`
      )
    }
    return {
      key,
      projectLanguages: project.languages,
      cellId: { keyId, language: target.language, scope: target.brandId },
    }
  }

  /** The standard text, or null when missing or the language is no project language. */
  private async standardText(
    keyId: string,
    language: string,
    projectLanguages: string[]
  ): Promise<string | null> {
    if (!projectLanguages.includes(language)) return null
    const standard = await this.prisma.translationValue.findUnique({
      where: {
        keyId_language_scope: { keyId, language, scope: DEFAULT_SCOPE },
      },
    })
    return standard && standard.value !== '' ? standard.value : null
  }
}
