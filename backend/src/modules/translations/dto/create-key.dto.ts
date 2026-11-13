import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateBy,
  ValidationOptions,
} from 'class-validator'
import {
  isValidKey,
  MAX_DESCRIPTION_LENGTH,
  NAMESPACE_PATTERN,
} from '../limits'

/** Key path rules from `isValidKey` (length, dots, control characters). */
export function IsTranslationKey(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isTranslationKey',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidKey(value),
        defaultMessage: () => '$property must be a valid translation key',
      },
    },
    options
  )
}

export class CreateKeyDto {
  @IsString()
  @Matches(NAMESPACE_PATTERN)
  @IsOptional()
  namespace?: string

  @IsTranslationKey()
  key: string

  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  @IsOptional()
  description?: string
}
