import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AccessService } from '../../shared/access/access.service'
import { AuthGuard } from '../../shared/auth.guard'
import {
  AiTranslationService,
  ApplyResult,
  PreviewMissingResult,
  SuggestResult,
} from './ai-translation.service'
import { AiTranslator } from './ai-translator'
import { ApplyDto } from './dto/apply.dto'
import { PreviewMissingDto } from './dto/preview-missing.dto'
import { SuggestDto } from './dto/suggest.dto'

/** At most 20 calls per minute that reach the AI provider. */
const AI_THROTTLE = { default: { ttl: 60_000, limit: 20 } }

@Controller()
@UseGuards(AuthGuard)
export class AiTranslationController {
  constructor(
    private readonly service: AiTranslationService,
    private readonly translator: AiTranslator,
    private readonly access: AccessService
  ) {}

  @Get('ai-translation/status')
  status(): { enabled: boolean } {
    return { enabled: this.translator.isEnabled() }
  }

  @Post('projects/:projectId/translations/ai/suggest')
  @HttpCode(200)
  @Throttle(AI_THROTTLE)
  async suggest(
    @Param('projectId') projectId: string,
    @Body() dto: SuggestDto,
    @Req() req: any
  ): Promise<SuggestResult> {
    await this.assertAccess(req.user.userId, projectId, dto.brandId)
    return this.service.suggest(projectId, dto)
  }

  @Post('projects/:projectId/translations/ai/preview-missing')
  @HttpCode(200)
  @Throttle(AI_THROTTLE)
  async previewMissing(
    @Param('projectId') projectId: string,
    @Body() dto: PreviewMissingDto,
    @Req() req: any
  ): Promise<PreviewMissingResult> {
    await this.assertAccess(req.user.userId, projectId)
    return this.service.previewMissing(projectId, dto)
  }

  @Post('projects/:projectId/translations/ai/apply')
  @HttpCode(200)
  async apply(
    @Param('projectId') projectId: string,
    @Body() dto: ApplyDto,
    @Req() req: any
  ): Promise<ApplyResult> {
    await this.assertAccess(req.user.userId, projectId, dto.brandId)
    return this.service.apply(projectId, req.user.userId, dto)
  }

  private async assertAccess(
    userId: string,
    projectId: string,
    brandId?: string
  ) {
    await this.access.assertProjectAccess(userId, projectId, 'MEMBER')
    if (brandId) await this.access.assertBrandInProject(brandId, projectId)
  }
}
