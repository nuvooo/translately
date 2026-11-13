import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ANTHROPIC_CLIENT } from './ai-translation.constants'
import { AiTranslationController } from './ai-translation.controller'
import { AiTranslationService } from './ai-translation.service'
import { AiTranslator, createAnthropicClient } from './ai-translator'

@Module({
  controllers: [AiTranslationController],
  providers: [
    {
      provide: ANTHROPIC_CLIENT,
      useFactory: (config: ConfigService) =>
        createAnthropicClient(config.get<string>('ANTHROPIC_API_KEY')),
      inject: [ConfigService],
    },
    AiTranslator,
    AiTranslationService,
  ],
  exports: [AiTranslator, AiTranslationService],
})
export class AiTranslationModule {}
