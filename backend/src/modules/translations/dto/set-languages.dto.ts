import {
  ArrayMaxSize,
  IsArray,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator'
import { LANGUAGE_PATTERN } from '../limits'

/**
 * Upper bound for the raw arrays, so oversized bodies are rejected before
 * any per-item work. Generous on purpose: duplicates are allowed here and
 * the service enforces `MAX_LANGUAGES` after de-duplication.
 */
export const MAX_LANGUAGE_ARRAY = 1000

/** De-duplication and the `MAX_LANGUAGES` limit are applied by the service. */
export class SetLanguagesDto {
  @IsArray()
  @ArrayMaxSize(MAX_LANGUAGE_ARRAY)
  @IsString({ each: true })
  @Matches(LANGUAGE_PATTERN, { each: true })
  languages: string[]

  /**
   * The list the client started from. When given, the server only writes if
   * the stored list still equals it exactly (409 otherwise). May be omitted;
   * `null` is rejected (a client that sends the field must send an array).
   */
  @ValidateIf((o: SetLanguagesDto) => o.expected !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_LANGUAGE_ARRAY)
  @IsString({ each: true })
  @Matches(LANGUAGE_PATTERN, { each: true })
  expected?: string[]
}
