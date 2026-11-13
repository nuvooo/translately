import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { LANGUAGE_PATTERN, MAX_VALUE_LENGTH } from '../../translations/limits'

export const MAX_APPLY_VALUES = 200

export class ApplyValueDto {
  @IsMongoId()
  keyId: string

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_VALUE_LENGTH)
  value: string
}

export class ApplyDto {
  @IsString()
  @Matches(LANGUAGE_PATTERN)
  targetLanguage: string

  @IsMongoId()
  @IsOptional()
  brandId?: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_APPLY_VALUES)
  @ValidateNested({ each: true })
  @Type(() => ApplyValueDto)
  values: ApplyValueDto[]
}
