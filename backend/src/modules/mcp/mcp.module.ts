import { Module } from '@nestjs/common'
import { AiTranslationModule } from '../ai-translation/ai-translation.module'
import { TranslationsModule } from '../translations/translations.module'
import { McpController } from './mcp.controller'
import { McpAiRateLimiter } from './mcp-ai-rate-limiter'
import { McpKeyResolver } from './mcp-key.resolver'
import { McpThrottlerGuard } from './mcp-throttler.guard'
import { McpToolsService } from './mcp-tools.service'

@Module({
  imports: [TranslationsModule, AiTranslationModule],
  controllers: [McpController],
  providers: [
    McpKeyResolver,
    McpToolsService,
    McpThrottlerGuard,
    McpAiRateLimiter,
  ],
})
export class McpModule {}
