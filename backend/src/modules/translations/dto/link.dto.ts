import { IsString, Matches } from 'class-validator'
import { LANGUAGE_PATTERN } from '../limits'

export class LinkDto {
  @IsString()
  @Matches(LANGUAGE_PATTERN)
  language: string
}
