import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ApiKeyType, OrganizationRole } from '@prisma/client'
import * as crypto from 'crypto'
import { hasRole } from '../../shared/access/access.service'
import { PrismaService } from '../../shared/prisma.service'
import { isPrismaUniqueConstraintError } from '../../shared/prisma-errors'

const API_KEY_LIST_SELECT = {
  id: true,
  name: true,
  key: true,
  type: true,
  userId: true,
  projectId: true,
  isActive: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
  organizationId: true,
  organization: { select: { id: true, name: true } },
} as const

/** Hashes an API key (sha256 hex) for lookup of hash-stored keys. */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

/** Masks an API key so that it can be shown to non-admin members. */
export function maskApiKey(key: string): string {
  if (!key || key.length <= 11) return '…'
  return `${key.slice(0, 7)}…${key.slice(-4)}`
}

@Injectable()
export class ApiKeysService {
  private static readonly allowedKeyTypes = new Set<ApiKeyType>([
    'SERVER',
    'CLIENT',
    'SDK',
    'MCP',
  ])

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the API keys of every organization the user belongs to. The full
   * key is only revealed to ADMIN/OWNER members of the key's organization.
   */
  async findByUser(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true, role: true },
    })

    if (!memberships.length) return []

    const roleByOrg = new Map<string, OrganizationRole>(
      memberships.map((m) => [m.organizationId, m.role])
    )

    const keys = await this.prisma.apiKey.findMany({
      where: { organizationId: { in: [...roleByOrg.keys()] } },
      select: API_KEY_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    })

    return keys
      .filter((k) => this.isVisible(k, userId, roleByOrg.get(k.organizationId)))
      .map((k) => this.maskForRole(k, roleByOrg.get(k.organizationId)))
  }

  /** Returns the API keys of one organization, masked according to `role`. */
  async findByOrganization(
    orgId: string,
    role: OrganizationRole,
    userId?: string
  ) {
    const keys = await this.prisma.apiKey.findMany({
      where: { organizationId: orgId },
      select: API_KEY_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    })
    return keys
      .filter((k) => this.isVisible(k, userId, role))
      .map((k) => this.maskForRole(k, role))
  }

  /** Below ADMIN, MCP keys of other users are hidden. */
  private isVisible(
    k: { type: ApiKeyType; userId?: string | null },
    userId: string | undefined,
    role: OrganizationRole | undefined
  ): boolean {
    if (role && hasRole(role, 'ADMIN')) return true
    return k.type !== 'MCP' || k.userId === userId
  }

  async create(
    orgId: string,
    userId: string,
    data: {
      name: string
      type?: string
      expiresInDays?: number
      projectId?: string
    }
  ) {
    const type = this.parseApiKeyType(data.type)
    const isMcp = type === 'MCP'
    if (isMcp && !data.projectId) {
      throw new BadRequestException('projectId is required for MCP keys')
    }
    if (isMcp) {
      const project = await this.prisma.project.findFirst({
        where: { id: data.projectId, organizationId: orgId },
        select: { id: true },
      })
      if (!project) throw new NotFoundException('Project not found')
    }
    const key = this.generateKey(isMcp)

    const expiresAt = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)
      : null

    if (!isMcp) {
      return this.prisma.apiKey.create({
        data: {
          name: data.name,
          key,
          type,
          organizationId: orgId,
          userId,
          expiresAt,
          isActive: true,
        },
      })
    }

    // MCP keys: only the hash and a masked key are persisted; the plain key is
    // returned exactly once. The masked form lives in the globally unique `key`
    // column and can collide, so retry with a fresh key on P2002.
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const plain = attempt === 1 ? key : this.generateKey(true)
      try {
        const created = await this.prisma.apiKey.create({
          data: {
            name: data.name,
            key: maskApiKey(plain),
            keyHash: hashApiKey(plain),
            type,
            organizationId: orgId,
            userId,
            projectId: data.projectId,
            expiresAt,
            isActive: true,
          },
        })
        // keyHash must never leave the service.
        const { keyHash: _keyHash, ...rest } = created
        return { ...rest, key: plain }
      } catch (error) {
        if (!isPrismaUniqueConstraintError(error)) throw error
      }
    }
    throw new ConflictException('Could not generate a unique key, please try again')
  }

  private generateKey(isMcp = false): string {
    return `${isMcp ? 'tkm_' : 'tk_'}${crypto.randomBytes(32).toString('hex')}`
  }

  private maskForRole<T extends { key: string }>(
    apiKey: T,
    role: OrganizationRole | undefined
  ): T {
    if (role && hasRole(role, 'ADMIN')) return apiKey
    return { ...apiKey, key: maskApiKey(apiKey.key) }
  }

  private parseApiKeyType(type?: string): ApiKeyType {
    // SDK is a legacy type of the product this one was copied from; it is
    // still accepted for existing keys, but new keys default to CLIENT.
    if (!type) {
      return 'CLIENT'
    }

    if (!ApiKeysService.allowedKeyTypes.has(type as ApiKeyType)) {
      throw new BadRequestException(`Invalid API key type: ${type}`)
    }

    return type as ApiKeyType
  }

  /** Deletes a key, scoped to its organization to prevent cross-tenant deletes. */
  async delete(keyId: string, organizationId: string) {
    await this.prisma.apiKey.deleteMany({
      where: { id: keyId, organizationId },
    })
  }
}
