import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator'
import { LANGUAGE_PATTERN } from '../../translations/limits'

export const MAX_SUGGEST_KEYS = 50

export class SuggestDto {
  @IsString()
  @Matches(LANGUAGE_PATTERN)
  sourceLanguage: string

  @IsString()
  @Matches(LANGUAGE_PATTERN)
  targetLanguage: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SUGGEST_KEYS)
  @IsMongoId({ each: true })
  keyIds: string[]

  @IsMongoId()
  @IsOptional()
  brandId?: string
}
