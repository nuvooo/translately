import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { OrganizationRole, TranslationKey } from '@prisma/client'
import { PrismaService } from '../prisma.service'

const ROLE_RANK: Record<OrganizationRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
}

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i

/** Returns true if the value is a syntactically valid MongoDB ObjectId. */
export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value)
}

/** Returns true if `role` is at least as privileged as `minRole`. */
export function hasRole(role: OrganizationRole, minRole: OrganizationRole) {
  return ROLE_RANK[role] >= ROLE_RANK[minRole]
}

/**
 * Central tenant-isolation checks. Every endpoint that touches
 * organization-scoped data must resolve the resource through one of these
 * methods before reading or mutating it.
 *
 * Non-members get a 404 (not 403) so that resource ids of other tenants
 * cannot be probed.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Asserts that the user is a member of the org with at least `minRole`. */
  async assertOrgRole(
    userId: string,
    organizationId: string,
    minRole: OrganizationRole = 'VIEWER'
  ) {
    if (!isObjectId(organizationId) || !isObjectId(userId)) {
      throw new NotFoundException('Organization not found')
    }

    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId, organizationId },
    })

    if (!membership) {
      throw new NotFoundException('Organization not found')
    }

    if (!hasRole(membership.role, minRole)) {
      throw new ForbiddenException('Insufficient permissions')
    }

    return membership
  }

  async assertProjectAccess(
    userId: string,
    projectId: string,
    minRole: OrganizationRole = 'VIEWER'
  ) {
    const project = isObjectId(projectId)
      ? await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true, organizationId: true },
        })
      : null
    if (!project) throw new NotFoundException('Project not found')

    const membership = await this.assertOrgRole(
      userId,
      project.organizationId,
      minRole
    )
    return { project, membership }
  }

  async assertBrandAccess(
    userId: string,
    brandId: string,
    minRole: OrganizationRole = 'VIEWER'
  ) {
    const brand = isObjectId(brandId)
      ? await this.prisma.brand.findUnique({
          where: { id: brandId },
          select: { id: true, projectId: true },
        })
      : null
    if (!brand) throw new NotFoundException('Brand not found')

    const { project, membership } = await this.assertProjectAccess(
      userId,
      brand.projectId,
      minRole
    )
    return { brand, project, membership }
  }

  async assertTranslationKeyAccess(
    userId: string,
    keyId: string,
    minRole: OrganizationRole = 'VIEWER'
  ): Promise<{ key: TranslationKey }> {
    const key = isObjectId(keyId)
      ? await this.prisma.translationKey.findUnique({ where: { id: keyId } })
      : null
    if (!key) throw new NotFoundException('Translation key not found')

    await this.assertProjectAccess(userId, key.projectId, minRole)
    return { key }
  }

  async assertApiKeyAccess(
    userId: string,
    apiKeyId: string,
    minRole: OrganizationRole = 'ADMIN'
  ) {
    const apiKey = isObjectId(apiKeyId)
      ? await this.prisma.apiKey.findUnique({
          where: { id: apiKeyId },
          select: { id: true, organizationId: true, type: true, userId: true },
        })
      : null
    if (!apiKey) throw new NotFoundException('API key not found')

    const membership = await this.assertOrgRole(
      userId,
      apiKey.organizationId,
      minRole
    )
    return { apiKey, membership }
  }

  /** Asserts that a brand belongs to the given project. */
  async assertBrandInProject(brandId: string, projectId: string) {
    const brand = isObjectId(brandId)
      ? await this.prisma.brand.findFirst({
          where: { id: brandId, projectId },
          select: { id: true },
        })
      : null
    if (!brand) throw new NotFoundException('Brand not found')
    return brand
  }
}
