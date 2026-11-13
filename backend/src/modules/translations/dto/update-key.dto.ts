import { IsOptional, IsString, MaxLength } from 'class-validator'
import { MAX_DESCRIPTION_LENGTH } from '../limits'
import { IsTranslationKey } from './create-key.dto'

export class UpdateKeyDto {
  @IsTranslationKey()
  @IsOptional()
  key?: string

  /** `null` clears the description. */
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  @IsOptional()
  description?: string | null
}
