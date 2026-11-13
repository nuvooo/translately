import {
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator'
import { LANGUAGE_PATTERN, MAX_VALUE_LENGTH } from '../limits'

export class SetValueDto {
  @IsString()
  @Matches(LANGUAGE_PATTERN)
  language: string

  @IsMongoId()
  @IsOptional()
  brandId?: string

  /** `''` removes the text of this view (re-links a brand to the standard text). */
  @IsString()
  @MaxLength(MAX_VALUE_LENGTH)
  value: string
}
