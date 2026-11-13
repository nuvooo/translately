import { IsString, Matches } from 'class-validator'
import { NAMESPACE_PATTERN } from '../limits'

export class NamespaceDto {
  @IsString()
  @Matches(NAMESPACE_PATTERN)
  namespace: string
}
