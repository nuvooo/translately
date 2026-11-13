import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator'
import { MAX_PAGE_SIZE, NAMESPACE_PATTERN } from '../limits'
import { TableQuery } from '../translations.service'

export const MAX_SEARCH_LENGTH = 200

function toBoolean({ value }: { value: unknown }) {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

/** Query strings become numbers; anything non-numeric stays as is and fails `IsInt`. */
function toNumber({ value }: { value: unknown }) {
  if (typeof value !== 'string' || value.trim() === '') return value
  const parsed = Number(value)
  return Number.isNaN(parsed) ? value : parsed
}

export class TableQueryDto implements TableQuery {
  @IsString()
  @Matches(NAMESPACE_PATTERN)
  @IsOptional()
  namespace?: string

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  @IsOptional()
  search?: string

  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  missingOnly?: boolean

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number

  @Transform((params) => {
    const value = toNumber(params)
    return typeof value === 'number' && value > MAX_PAGE_SIZE
      ? MAX_PAGE_SIZE
      : value
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  pageSize?: number
}
