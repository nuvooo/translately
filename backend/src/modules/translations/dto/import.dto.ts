import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  PipeTransform,
  ValidationPipe,
} from '@nestjs/common'
import {
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator'
import { LANGUAGE_PATTERN, NAMESPACE_PATTERN } from '../limits'
import { ImportTarget } from '../translation-import.service'

const MAX_LANGUAGE_LENGTH = 64

/** Target view of an import or export (language, namespace and optionally brand). */
export class ImportTargetDto implements ImportTarget {
  @IsString()
  @MaxLength(MAX_LANGUAGE_LENGTH)
  @Matches(LANGUAGE_PATTERN)
  language: string

  @IsString()
  @Matches(NAMESPACE_PATTERN)
  @IsOptional()
  namespace?: string

  @IsMongoId()
  @IsOptional()
  brandId?: string
}

/** `GET …/translations/export` query. */
export class ExportQueryDto extends ImportTargetDto {}

const TARGET_FIELDS = ['language', 'namespace', 'brandId']

/**
 * The target fields of an import body, and nothing else. The body's `content`
 * is arbitrary user data (up to 2 MB, possibly with `__proto__` keys), so it
 * must never reach class-transformer: `@Body() dto` would run the global
 * ValidationPipe's plainToInstance over the whole body. Only these three own
 * properties are copied and validated (see `importTargetPipe`).
 */
export const ImportTargetBody = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Record<string, unknown> => {
    const body: unknown = context.switchToHttp().getRequest().body
    const target: Record<string, unknown> = {}
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return target
    }
    for (const field of TARGET_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(body, field)
      if (descriptor !== undefined) target[field] = descriptor.value
    }
    return target
  }
)

/** The global ValidationPipe skips custom decorators; this one validates `ImportTargetBody`. */
export const importTargetPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  validateCustomDecorators: true,
})

/** Passes `content` through untouched (same reference) if it is a JSON object. */
@Injectable()
export class ImportContentPipe implements PipeTransform {
  transform(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('content must be a JSON object')
    }
    return value as Record<string, unknown>
  }
}
