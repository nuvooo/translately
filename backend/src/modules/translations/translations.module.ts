import { Module } from '@nestjs/common'
import { TranslationFilesService } from './translation-files.service'
import { TranslationImportService } from './translation-import.service'
import { TranslationLinkService } from './translation-link.service'
import { TranslationSettingsService } from './translation-settings.service'
import { TranslationsController } from './translations.controller'
import { TranslationsService } from './translations.service'

@Module({
  controllers: [TranslationsController],
  providers: [
    TranslationsService,
    TranslationLinkService,
    TranslationSettingsService,
    TranslationFilesService,
    TranslationImportService,
  ],
  exports: [
    TranslationFilesService,
    TranslationsService,
    TranslationSettingsService,
  ],
})
export class TranslationsModule {}
