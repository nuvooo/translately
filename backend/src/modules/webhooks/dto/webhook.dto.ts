import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

export const WEBHOOK_URL_MAX_LENGTH = 2048
export const WEBHOOK_DESCRIPTION_MAX_LENGTH = 200

export class CreateWebhookDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WEBHOOK_URL_MAX_LENGTH)
  url: string

  @IsOptional()
  @IsString()
  @MaxLength(WEBHOOK_DESCRIPTION_MAX_LENGTH)
  description?: string

  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(WEBHOOK_URL_MAX_LENGTH)
  url?: string

  /** Empty string clears the description */
  @IsOptional()
  @IsString()
  @MaxLength(WEBHOOK_DESCRIPTION_MAX_LENGTH)
  description?: string

  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}
