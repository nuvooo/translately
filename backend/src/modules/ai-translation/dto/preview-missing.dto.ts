import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator'
import { LANGUAGE_PATTERN, NAMESPACE_PATTERN } from '../../translations/limits'

export const MAX_PREVIEW_TARGETS = 3
export const MAX_PREVIEW_LIMIT = 50
export const DEFAULT_PREVIEW_LIMIT = 40

export class PreviewMissingDto {
  @IsString()
  @Matches(NAMESPACE_PATTERN)
  @IsOptional()
  namespace?: string

  @IsString()
  @Matches(LANGUAGE_PATTERN)
  sourceLanguage: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PREVIEW_TARGETS)
  @IsString({ each: true })
  @Matches(LANGUAGE_PATTERN, { each: true })
  targetLanguages: string[]

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PREVIEW_LIMIT)
  @IsOptional()
  limit?: number
}
