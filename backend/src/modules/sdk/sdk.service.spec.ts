import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { SdkService } from './sdk.service'

const mockProject = {
  id: 'proj-1',
  key: 'my-project',
  type: 'SINGLE',
  organizationId: 'org-1',
  allowedOrigins: [] as string[],
}

const mockApiKey = {
  id: 'key-1',
  organizationId: 'org-1',
}

function createService() {
  const prisma = {
    apiKey: {
      findFirst: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
    },
    brand: {
      findFirst: jest.fn(),
    },
  } as any

  const service = new SdkService(prisma)
  return { service, prisma }
}

function mockValidAccess(prisma: any, project: any = mockProject) {
  prisma.apiKey.findFirst.mockResolvedValue(mockApiKey)
  prisma.project.findFirst.mockResolvedValue(project)
}

describe('SdkService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('resolveSdkAccess', () => {
    it('looks up an active, non-expired key and scopes the project lookup', async () => {
      const { service, prisma } = createService()
      mockValidAccess(prisma)

      const access = await service.resolveSdkAccess(
        'my-project',
        'test-api-key'
      )

      expect(access).toEqual({
        organizationId: 'org-1',
        apiKeyId: 'key-1',
        project: mockProject,
      })

      const keyWhere = prisma.apiKey.findFirst.mock.calls[0][0].where
      expect(keyWhere.key).toBe('test-api-key')
      expect(keyWhere.isActive).toBe(true)
      expect(keyWhere.OR).toEqual(
        expect.arrayContaining([
          { expiresAt: null },
          { expiresAt: { gt: expect.any(Date) } },
        ])
      )

      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', key: 'my-project' },
      })
    })

    it('rejects non-string api keys before reaching Prisma', async () => {
      const { service, prisma } = createService()

      await expect(
        service.resolveSdkAccess('my-project', {
          $ne: null,
        } as any)
      ).rejects.toBeInstanceOf(UnauthorizedException)
      await expect(
        service.resolveSdkAccess('my-project', '')
      ).rejects.toBeInstanceOf(UnauthorizedException)
      await expect(
        service.resolveSdkAccess('my-project', 'x'.repeat(1000))
      ).rejects.toBeInstanceOf(UnauthorizedException)

      expect(prisma.apiKey.findFirst).not.toHaveBeenCalled()
    })

    it('rejects an MCP row whose stored key equals the presented string like an unknown key', async () => {
      const { service, prisma } = createService()
      const rows = [
        { id: 'mcp-1', key: 'tkm_abc…1234', type: 'MCP', organizationId: 'org-1' },
      ]
      prisma.apiKey.findFirst.mockImplementation(async ({ where }: any) =>
        rows.find(
          (r) =>
            r.key === where.key &&
            !(where.type?.not && r.type === where.type.not)
        ) ?? null
      )

      await expect(
        service.resolveSdkAccess('my-project', 'tkm_abc…1234')
      ).rejects.toBeInstanceOf(UnauthorizedException)
      expect(prisma.apiKey.findFirst.mock.calls[0][0].where.type).toEqual({
        not: 'MCP',
      })
      expect(prisma.project.findFirst).not.toHaveBeenCalled()
    })

    it('rejects expired or inactive keys (not found by the filtered query)', async () => {
      const { service, prisma } = createService()
      prisma.apiKey.findFirst.mockResolvedValue(null)

      await expect(
        service.resolveSdkAccess('my-project', 'expired-key')
      ).rejects.toBeInstanceOf(UnauthorizedException)
      expect(prisma.project.findFirst).not.toHaveBeenCalled()
    })

    it('grants a key of the organization access without any environment', async () => {
      const { service, prisma } = createService()
      mockValidAccess(prisma)

      const access = await service.resolveSdkAccess(
        'my-project',
        'test-api-key'
      )

      expect(access.project).toBe(mockProject)
      expect(access).not.toHaveProperty('environment')
    })

    it('rejects look-alike origins for wildcard entries', async () => {
      const { service, prisma } = createService()
      mockValidAccess(prisma, {
        ...mockProject,
        allowedOrigins: ['*.example.com'],
      })

      await expect(
        service.resolveSdkAccess(
          'my-project',
          'test-api-key',
          'https://evilexample.com'
        )
      ).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  describe('cross-tenant isolation', () => {
    // Two organizations both own a project with key "shared". The attacker's
    // API key belongs to org-attacker; it must never resolve the victim's
    // project.
    const victimProject = {
      ...mockProject,
      id: 'proj-victim',
      key: 'shared',
      organizationId: 'org-victim',
    }
    const attackerProject = {
      ...mockProject,
      id: 'proj-attacker',
      key: 'shared',
      organizationId: 'org-attacker',
    }
    const projects = [victimProject, attackerProject]

    function createMultiTenantService() {
      const ctx = createService()
      const { prisma } = ctx
      const matches = (row: any, where: any) =>
        Object.entries(where).every(([k, v]) => row[k] === v)

      prisma.apiKey.findFirst.mockImplementation(async ({ where }: any) =>
        where.key === 'attacker-key'
          ? {
              id: 'key-attacker',
              organizationId: 'org-attacker',
            }
          : null
      )
      prisma.project.findFirst.mockImplementation(
        async ({ where }: any) =>
          projects.find((p) => matches(p, where)) ?? null
      )
      return ctx
    }

    it('resolves only the attacker org project', async () => {
      const { service, prisma } = createMultiTenantService()

      const access = await service.resolveSdkAccess('shared', 'attacker-key')

      expect(access.project.id).toBe('proj-attacker')
      for (const [args] of prisma.project.findFirst.mock.calls) {
        expect(args.where.organizationId).toBe('org-attacker')
      }
    })
  })

  describe('resolveSdkAccess errors', () => {
    it('throws when API key is invalid', async () => {
      const { service, prisma } = createService()
      prisma.apiKey.findFirst.mockResolvedValue(null)

      await expect(
        service.resolveSdkAccess('my-project', 'invalid-key')
      ).rejects.toBeInstanceOf(UnauthorizedException)
    })

    it('throws Unauthorized when project is not in the key organization', async () => {
      const { service, prisma } = createService()
      prisma.apiKey.findFirst.mockResolvedValue(mockApiKey)
      prisma.project.findFirst.mockResolvedValue(null)

      await expect(
        service.resolveSdkAccess('my-project', 'test-api-key')
      ).rejects.toBeInstanceOf(UnauthorizedException)
    })

    it('throws ForbiddenException when origin is not allowed', async () => {
      const { service, prisma } = createService()
      mockValidAccess(prisma, {
        ...mockProject,
        allowedOrigins: ['https://example.com'],
      })

      await expect(
        service.resolveSdkAccess(
          'my-project',
          'test-api-key',
          'https://evil.com'
        )
      ).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  describe('resolveBrandId', () => {
    const multiProject = { ...mockProject, type: 'MULTI' } as any

    it('resolves a brand by key for a MULTI project', async () => {
      const { service, prisma } = createService()
      prisma.brand.findFirst.mockResolvedValueOnce({
        id: 'brand-1',
        key: 'brand-a',
      })

      await expect(
        service.resolveBrandId(multiProject, 'brand-a')
      ).resolves.toBe('brand-1')
      expect(prisma.brand.findFirst).toHaveBeenCalledWith({
        where: { projectId: 'proj-1', key: 'brand-a' },
      })
    })

    it('returns null for SINGLE projects and without a brand key', async () => {
      const { service, prisma } = createService()

      await expect(
        service.resolveBrandId(mockProject as any, 'brand-a')
      ).resolves.toBeNull()
      await expect(service.resolveBrandId(multiProject)).resolves.toBeNull()
      expect(prisma.brand.findFirst).not.toHaveBeenCalled()
    })

    it('does not query brand by id for non-ObjectId brand keys', async () => {
      const { service, prisma } = createService()
      prisma.brand.findFirst.mockResolvedValue(null)

      await expect(
        service.resolveBrandId(multiProject, 'not-an-object-id')
      ).resolves.toBeNull()
      expect(prisma.brand.findFirst).toHaveBeenCalledTimes(1)
    })

    it('falls back to brand id lookup (scoped to project) for ObjectId brand keys', async () => {
      const { service, prisma } = createService()
      const brandId = '507f1f77bcf86cd799439011'
      prisma.brand.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: brandId, key: 'brand-a' })

      await expect(service.resolveBrandId(multiProject, brandId)).resolves.toBe(
        brandId
      )
      expect(prisma.brand.findFirst).toHaveBeenLastCalledWith({
        where: { projectId: 'proj-1', id: brandId },
      })
    })
  })

  describe('resolveSdkAccess key type', () => {
    it('returns the API key type to the caller', async () => {
      const { service, prisma } = createService()
      mockValidAccess(prisma)
      prisma.apiKey.findFirst.mockResolvedValue({
        ...mockApiKey,
        type: 'CLIENT',
      })

      const access = await service.resolveSdkAccess('my-project', 'k')

      expect(access.apiKeyType).toBe('CLIENT')
      expect(prisma.apiKey.findFirst.mock.calls[0][0].select).toMatchObject({
        type: true,
      })
    })
  })
})
