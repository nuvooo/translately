import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { Project } from '@prisma/client'
import { PrismaService } from '../../shared/prisma.service'
import { isOriginAllowed } from './sdk.helpers'

/** Upper bound for SDK-supplied identifiers (api key, project/brand keys). */
const MAX_SDK_IDENTIFIER_LENGTH = 256
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i

export interface SdkAccess {
  organizationId: string
  apiKeyId: string
  /** SERVER | CLIENT | SDK */
  apiKeyType?: string
  project: Project
}

function isValidIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SDK_IDENTIFIER_LENGTH
  )
}

@Injectable()
export class SdkService {
  private readonly logger = new Logger(SdkService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Authenticate an SDK request and resolve the project it targets. All lookups are scoped to the API key's organization, so a
   * project key that also exists in another organization can never be
   * resolved through this key.
   *
   * Throws UnauthorizedException (invalid/expired key or project not in the
   * key's organization) or ForbiddenException (origin not allowed).
   */
  async resolveSdkAccess(
    projectKey: string,
    apiKey: string,
    origin?: string
  ): Promise<SdkAccess> {
    if (!isValidIdentifier(apiKey)) {
      throw new UnauthorizedException('Invalid API key')
    }
    if (!isValidIdentifier(projectKey)) {
      throw new UnauthorizedException(
        'API key does not have access to this project'
      )
    }

    this.logger.debug(
      `[SDK Service] Validating API key for project: ${projectKey}`
    )

    const keyRecord = await this.prisma.apiKey.findFirst({
      where: {
        key: apiKey,
        // MCP rows store a masked, listable `key`; it must never authenticate.
        type: { not: 'MCP' },
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { isSet: false } },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: {
        id: true,
        organizationId: true,
        type: true,
      },
    })

    if (!keyRecord) {
      this.logger.debug(
        `[SDK Service] ERROR: API key not found, inactive or expired`
      )
      throw new UnauthorizedException('Invalid API key')
    }

    const project = await this.prisma.project.findFirst({
      where: { organizationId: keyRecord.organizationId, key: projectKey },
    })

    if (!project) {
      this.logger.debug(
        `[SDK Service] ERROR: Project ${projectKey} not found in organization`
      )
      throw new UnauthorizedException(
        'API key does not have access to this project'
      )
    }

    // Check origin if project has allowedOrigins
    if (origin && project.allowedOrigins && project.allowedOrigins.length > 0) {
      if (!isOriginAllowed(origin, project.allowedOrigins)) {
        this.logger.debug(
          `[SDK Service] ERROR: Origin ${origin} not in allowedOrigins`
        )
        throw new ForbiddenException('Origin not allowed')
      }
    }

    return {
      organizationId: keyRecord.organizationId,
      apiKeyId: keyRecord.id,
      apiKeyType: keyRecord.type,
      project,
    }
  }

  /**
   * Resolve a brand of the given project by key, or by id when the value is a
   * valid ObjectId. Anything else is treated as "not found". Returns null
   * without a brand key, for non-MULTI (e.g. SINGLE) projects and for an
   * unknown brand.
   */
  async resolveBrandId(
    project: Project,
    brandKey?: string
  ): Promise<string | null> {
    if (!brandKey || project.type !== 'MULTI') return null
    if (!isValidIdentifier(brandKey)) return null

    let brand = await this.prisma.brand.findFirst({
      where: { projectId: project.id, key: brandKey },
    })

    // Fall back to id lookup only for well-formed ObjectIds, so arbitrary
    // input never reaches Prisma as an ObjectId (which would throw).
    if (!brand && OBJECT_ID_PATTERN.test(brandKey)) {
      brand = await this.prisma.brand.findFirst({
        where: { projectId: project.id, id: brandKey },
      })
    }

    if (!brand) {
      this.logger.debug(`[SDK Service] Brand not found for key/id: ${brandKey}`)
      return null
    }
    return brand.id
  }
}
