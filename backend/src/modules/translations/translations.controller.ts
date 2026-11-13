import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { AccessService } from '../../shared/access/access.service'
import { AuthGuard } from '../../shared/auth.guard'
import { CreateKeyDto } from './dto/create-key.dto'
import {
  ExportQueryDto,
  ImportContentPipe,
  ImportTargetBody,
  ImportTargetDto,
  importTargetPipe,
} from './dto/import.dto'
import { LinkDto } from './dto/link.dto'
import { LockKeyDto } from './dto/lock-key.dto'
import { NamespaceDto } from './dto/namespace.dto'
import { SetLanguagesDto } from './dto/set-languages.dto'
import { SetValueDto } from './dto/set-value.dto'
import { TableQueryDto } from './dto/table-query.dto'
import { UpdateKeyDto } from './dto/update-key.dto'
import {
  ImportPreview,
  ImportTarget,
  TranslationImportService,
} from './translation-import.service'
import { TranslationLinkService } from './translation-link.service'
import { TranslationSettingsService } from './translation-settings.service'
import { TranslationsService } from './translations.service'

@Controller()
@UseGuards(AuthGuard)
export class TranslationsController {
  constructor(
    private readonly translations: TranslationsService,
    private readonly access: AccessService,
    private readonly settings: TranslationSettingsService,
    private readonly imports: TranslationImportService,
    private readonly links: TranslationLinkService
  ) {}

  @Get('projects/:projectId/translations')
  async getTable(
    @Param('projectId') projectId: string,
    @Query() query: TableQueryDto,
    @Req() req: any
  ) {
    await this.access.assertProjectAccess(req.user.userId, projectId, 'VIEWER')
    return this.translations.getTable(projectId, query)
  }

  /** Dry run: what the import would add, change and skip. */
  @Post('projects/:projectId/translations/import/preview')
  @HttpCode(200)
  async previewImport(
    @Param('projectId') projectId: string,
    @ImportTargetBody(importTargetPipe) target: ImportTargetDto,
    @Body('content', ImportContentPipe) content: Record<string, unknown>,
    @Req() req: any
  ): Promise<ImportPreview> {
    await this.assertTargetAccess(req.user.userId, projectId, target, 'MEMBER')
    return this.imports.preview(projectId, target, content)
  }

  @Post('projects/:projectId/translations/import')
  @HttpCode(200)
  async applyImport(
    @Param('projectId') projectId: string,
    @ImportTargetBody(importTargetPipe) target: ImportTargetDto,
    @Body('content', ImportContentPipe) content: Record<string, unknown>,
    @Req() req: any
  ): Promise<ImportPreview> {
    await this.assertTargetAccess(req.user.userId, projectId, target, 'MEMBER')
    return this.imports.apply(projectId, req.user.userId, target, content)
  }

  @Get('projects/:projectId/translations/export')
  async exportFile(
    @Param('projectId') projectId: string,
    @Query() query: ExportQueryDto,
    @Req() req: any,
    @Res({ passthrough: true })
    res: { setHeader(name: string, value: string): unknown }
  ): Promise<Record<string, unknown>> {
    await this.assertTargetAccess(req.user.userId, projectId, query, 'VIEWER')
    // namespace and language are validated (patterns, view) at this point.
    const { namespace, language, tree } = await this.imports.exportFile(
      projectId,
      query
    )
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${namespace}.${language}.json"`
    )
    return tree
  }

  @Post('projects/:projectId/translation-keys')
  async createKey(
    @Param('projectId') projectId: string,
    @Body() dto: CreateKeyDto,
    @Req() req: any
  ) {
    await this.access.assertProjectAccess(req.user.userId, projectId, 'MEMBER')
    const key = await this.translations.createKey(
      projectId,
      req.user.userId,
      dto
    )
    return { key }
  }

  @Patch('translation-keys/:keyId')
  async updateKey(
    @Param('keyId') keyId: string,
    @Body() dto: UpdateKeyDto,
    @Req() req: any
  ) {
    await this.access.assertTranslationKeyAccess(
      req.user.userId,
      keyId,
      'MEMBER'
    )
    const key = await this.translations.updateKey(keyId, req.user.userId, dto)
    return { key }
  }

  /** Locking protects a key from renaming and deleting; same role as deleting. */
  @Put('translation-keys/:keyId/lock')
  async setKeyLocked(
    @Param('keyId') keyId: string,
    @Body() dto: LockKeyDto,
    @Req() req: any
  ) {
    await this.access.assertTranslationKeyAccess(
      req.user.userId,
      keyId,
      'ADMIN'
    )
    const key = await this.translations.setKeyLocked(
      keyId,
      req.user.userId,
      dto.locked
    )
    return { key }
  }

  @Delete('translation-keys/:keyId')
  async deleteKey(@Param('keyId') keyId: string, @Req() req: any) {
    await this.access.assertTranslationKeyAccess(
      req.user.userId,
      keyId,
      'ADMIN'
    )
    await this.translations.deleteKey(keyId, req.user.userId)
    return { success: true }
  }

  @Put('translation-keys/:keyId/value')
  async setValue(
    @Param('keyId') keyId: string,
    @Body() dto: SetValueDto,
    @Req() req: any
  ) {
    const { key } = await this.access.assertTranslationKeyAccess(
      req.user.userId,
      keyId,
      'MEMBER'
    )
    if (dto.brandId) {
      await this.access.assertBrandInProject(dto.brandId, key.projectId)
    }
    const cell = await this.translations.setValue(keyId, req.user.userId, dto)
    return { cell }
  }

  /** Creates the brand's own text from the current standard text. */
  @Post('translation-keys/:keyId/brands/:brandId/unlink')
  @HttpCode(200)
  async unlinkValue(
    @Param('keyId') keyId: string,
    @Param('brandId') brandId: string,
    @Body() dto: LinkDto,
    @Req() req: any
  ) {
    await this.assertLinkAccess(req.user.userId, keyId, brandId)
    const cell = await this.links.unlink(keyId, req.user.userId, {
      brandId,
      language: dto.language,
    })
    return { cell }
  }

  /** Deletes the brand's own text; the brand inherits the standard text again. */
  @Post('translation-keys/:keyId/brands/:brandId/link')
  @HttpCode(200)
  async linkValue(
    @Param('keyId') keyId: string,
    @Param('brandId') brandId: string,
    @Body() dto: LinkDto,
    @Req() req: any
  ) {
    await this.assertLinkAccess(req.user.userId, keyId, brandId)
    const cell = await this.links.link(keyId, req.user.userId, {
      brandId,
      language: dto.language,
    })
    return { cell }
  }

  @Put('projects/:projectId/languages')
  async setProjectLanguages(
    @Param('projectId') projectId: string,
    @Body() dto: SetLanguagesDto,
    @Req() req: any
  ) {
    await this.access.assertProjectAccess(req.user.userId, projectId, 'ADMIN')
    return this.settings.setProjectLanguages(
      projectId,
      req.user.userId,
      dto.languages,
      dto.expected
    )
  }

  @Put('brands/:brandId/languages')
  async setBrandLanguages(
    @Param('brandId') brandId: string,
    @Body() dto: SetLanguagesDto,
    @Req() req: any
  ) {
    await this.access.assertBrandAccess(req.user.userId, brandId, 'ADMIN')
    return this.settings.setBrandLanguages(
      brandId,
      req.user.userId,
      dto.languages,
      dto.expected
    )
  }

  @Post('projects/:projectId/namespaces')
  async addNamespace(
    @Param('projectId') projectId: string,
    @Body() dto: NamespaceDto,
    @Req() req: any
  ) {
    await this.access.assertProjectAccess(req.user.userId, projectId, 'ADMIN')
    return this.settings.addNamespace(projectId, req.user.userId, dto.namespace)
  }

  @Delete('projects/:projectId/namespaces/:namespace')
  async removeNamespace(
    @Param('projectId') projectId: string,
    @Param('namespace') namespace: string,
    @Req() req: any
  ) {
    await this.access.assertProjectAccess(req.user.userId, projectId, 'ADMIN')
    return this.settings.removeNamespace(projectId, req.user.userId, namespace)
  }

  private async assertTargetAccess(
    userId: string,
    projectId: string,
    target: ImportTarget,
    minRole: 'VIEWER' | 'MEMBER'
  ) {
    await this.access.assertProjectAccess(userId, projectId, minRole)
    if (target.brandId) {
      await this.access.assertBrandInProject(target.brandId, projectId)
    }
  }

  private async assertLinkAccess(
    userId: string,
    keyId: string,
    brandId: string
  ) {
    const { key } = await this.access.assertTranslationKeyAccess(
      userId,
      keyId,
      'MEMBER'
    )
    await this.access.assertBrandInProject(brandId, key.projectId)
  }
}
