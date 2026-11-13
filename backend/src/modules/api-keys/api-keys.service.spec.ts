import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { ApiKeysService, hashApiKey, maskApiKey } from './api-keys.service'

const FULL_KEY = `tk_${'a'.repeat(60)}beef`

describe('ApiKeysService', () => {
  it('rejects unsupported api key types', async () => {
    const prisma = {
      apiKey: {
        create: jest.fn(),
      },
    } as any

    const service = new ApiKeysService(prisma)

    await expect(
      service.create('org-1', 'user-1', {
        name: 'Invalid key',
        type: 'ROOT',
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('creates a Client key when no type is given (not the legacy SDK type)', async () => {
    const prisma = {
      apiKey: { create: jest.fn(async ({ data }: any) => data) },
    } as any
    const service = new ApiKeysService(prisma)

    const created = await service.create('org-1', 'user-1', { name: 'Web' })

    expect(created.type).toBe('CLIENT')
  })

  it('masks keys', () => {
    expect(maskApiKey(FULL_KEY)).toBe('tk_aaaa…beef')
    expect(maskApiKey('short')).toBe('…')
  })

  describe('findByUser', () => {
    function setup() {
      const prisma = {
        organizationMember: {
          findMany: jest.fn().mockResolvedValue([
            { organizationId: 'org-admin', role: 'ADMIN' },
            { organizationId: 'org-viewer', role: 'VIEWER' },
          ]),
        },
        apiKey: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'k1', key: FULL_KEY, organizationId: 'org-admin' },
            { id: 'k2', key: FULL_KEY, organizationId: 'org-viewer' },
          ]),
        },
      } as any
      return { prisma, service: new ApiKeysService(prisma) }
    }

    it('only queries keys of the user organizations', async () => {
      const { prisma, service } = setup()
      await service.findByUser('user-1')
      expect(prisma.apiKey.findMany.mock.calls[0][0].where).toEqual({
        organizationId: { in: ['org-admin', 'org-viewer'] },
      })
    })

    it('reveals full keys only to ADMIN/OWNER', async () => {
      const { service } = setup()
      const keys = await service.findByUser('user-1')
      expect(keys.find((k) => k.id === 'k1')!.key).toBe(FULL_KEY)
      expect(keys.find((k) => k.id === 'k2')!.key).toBe('tk_aaaa…beef')
    })

    it('returns [] without memberships', async () => {
      const { prisma, service } = setup()
      prisma.organizationMember.findMany.mockResolvedValue([])
      await expect(service.findByUser('user-1')).resolves.toEqual([])
      expect(prisma.apiKey.findMany).not.toHaveBeenCalled()
    })
  })

  it('findByOrganization masks keys for MEMBERs', async () => {
    const prisma = {
      apiKey: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'k1', key: FULL_KEY, organizationId: 'o' },
          ]),
      },
    } as any
    const service = new ApiKeysService(prisma)
    const keys = await service.findByOrganization('o', 'MEMBER')
    expect(keys[0].key).toBe('tk_aaaa…beef')
    expect(prisma.apiKey.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'o',
    })
  })

  it('findByOrganization below ADMIN hides other users MCP keys, keeps own MCP keys and other types masked', async () => {
    const prisma = {
      apiKey: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'own', type: 'MCP', userId: 'me', key: FULL_KEY },
          { id: 'other', type: 'MCP', userId: 'x', key: FULL_KEY },
          { id: 'srv', type: 'SERVER', userId: 'x', key: FULL_KEY },
        ]),
      },
    } as any
    const service = new ApiKeysService(prisma)
    const keys = await service.findByOrganization('o', 'MEMBER', 'me')
    expect(keys.map((k) => k.id)).toEqual(['own', 'srv'])
    expect(keys[1].key).toBe('tk_aaaa…beef')
    const admin = await service.findByOrganization('o', 'ADMIN', 'me')
    expect(admin).toHaveLength(3)
  })

  it('findByUser below ADMIN hides other users MCP keys', async () => {
    const prisma = {
      organizationMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ organizationId: 'o', role: 'MEMBER' }]),
      },
      apiKey: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'own',
            type: 'MCP',
            userId: 'me',
            key: FULL_KEY,
            organizationId: 'o',
          },
          {
            id: 'other',
            type: 'MCP',
            userId: 'x',
            key: FULL_KEY,
            organizationId: 'o',
          },
        ]),
      },
    } as any
    const keys = await new ApiKeysService(prisma).findByUser('me')
    expect(keys.map((k) => k.id)).toEqual(['own'])
  })

  it('never selects the key hash in listings and exposes projectId', async () => {
    const prisma = {
      apiKey: { findMany: jest.fn().mockResolvedValue([]) },
    } as any
    await new ApiKeysService(prisma).findByOrganization('o', 'ADMIN')
    const select = prisma.apiKey.findMany.mock.calls[0][0].select
    expect(select.keyHash).toBeUndefined()
    expect(select.projectId).toBe(true)
    expect(select.lastUsedAt).toBe(true)
  })

  describe('create MCP', () => {
    const PROJECT = '64a000000000000000000020'

    it('stores only hash and masked key, returns plain key once', async () => {
      const prisma = {
        project: { findFirst: jest.fn().mockResolvedValue({ id: PROJECT }) },
        apiKey: {
          create: jest.fn().mockImplementation(async ({ data }) => ({
            id: 'k',
            ...data,
          })),
        },
      } as any
      const result = await new ApiKeysService(prisma).create('org', 'u', {
        name: 'Claude',
        type: 'MCP',
        projectId: PROJECT,
      })
      expect(result.key).toMatch(/^tkm_[a-f0-9]{64}$/)
      const data = prisma.apiKey.create.mock.calls[0][0].data
      expect(data.key).toContain('…')
      expect(data.key).not.toBe(result.key)
      expect(data.keyHash).toBe(hashApiKey(result.key))
      expect(data.projectId).toBe(PROJECT)
      expect(JSON.stringify(data)).not.toContain(result.key)
      expect(prisma.apiKey.create.mock.calls[0][0].select).toBeUndefined()
      expect(result).not.toHaveProperty('keyHash')
    })

    it('without projectId throws BadRequestException', async () => {
      const prisma = { apiKey: { create: jest.fn() } } as any
      await expect(
        new ApiKeysService(prisma).create('org', 'u', {
          name: 'x',
          type: 'MCP',
        })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.apiKey.create).not.toHaveBeenCalled()
    })

    it('retries with a fresh key after a unique-constraint collision', async () => {
      const prisma = {
        project: { findFirst: jest.fn().mockResolvedValue({ id: PROJECT }) },
        apiKey: {
          create: jest
            .fn()
            .mockRejectedValueOnce({ code: 'P2002' })
            .mockImplementation(async ({ data }) => ({ id: 'k', ...data })),
        },
      } as any
      const result = await new ApiKeysService(prisma).create('org', 'u', {
        name: 'x',
        type: 'MCP',
        projectId: PROJECT,
      })
      expect(prisma.apiKey.create).toHaveBeenCalledTimes(2)
      const [first, second] = prisma.apiKey.create.mock.calls.map(
        (c: any) => c[0].data
      )
      expect(second.keyHash).not.toBe(first.keyHash)
      expect(second.keyHash).toBe(hashApiKey(result.key))
      expect(second.key).toBe(maskApiKey(result.key))
    })

    it('rethrows after 3 colliding attempts', async () => {
      const prisma = {
        project: { findFirst: jest.fn().mockResolvedValue({ id: PROJECT }) },
        apiKey: { create: jest.fn().mockRejectedValue({ code: 'P2002' }) },
      } as any
      await expect(
        new ApiKeysService(prisma).create('org', 'u', {
          name: 'x',
          type: 'MCP',
          projectId: PROJECT,
        })
      ).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.apiKey.create).toHaveBeenCalledTimes(3)
    })

    it('throws NotFoundException when the project is not in the organization', async () => {
      const prisma = {
        project: { findFirst: jest.fn().mockResolvedValue(null) },
        apiKey: { create: jest.fn() },
      } as any
      await expect(
        new ApiKeysService(prisma).create('org', 'u', {
          name: 'x',
          type: 'MCP',
          projectId: PROJECT,
        })
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: PROJECT, organizationId: 'org' },
        select: { id: true },
      })
      expect(prisma.apiKey.create).not.toHaveBeenCalled()
    })

    it('non-MCP keys ignore projectId and store no hash', async () => {
      const prisma = {
        apiKey: { create: jest.fn().mockResolvedValue({}) },
      } as any
      await new ApiKeysService(prisma).create('org', 'u', {
        name: 'x',
        type: 'SERVER',
        projectId: PROJECT,
      })
      const data = prisma.apiKey.create.mock.calls[0][0].data
      expect(data.projectId).toBeUndefined()
      expect(data.keyHash).toBeUndefined()
      expect(data.key).toMatch(/^tk_/)
    })
  })

  it('create stores the plain key with the tk_ prefix', async () => {
    const prisma = {
      apiKey: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'k',
          ...data,
        })),
      },
    } as any
    const result = await new ApiKeysService(prisma).create('org', 'u', {
      name: 'x',
      type: 'SERVER',
    })
    expect(result.key).toMatch(/^tk_[a-f0-9]{64}$/)
  })

  it('lists the creator user id (and no environment binding) for visibility checks', async () => {
    const prisma = {
      apiKey: { findMany: jest.fn().mockResolvedValue([]) },
    } as any
    await new ApiKeysService(prisma).findByOrganization('o', 'ADMIN')
    const select = prisma.apiKey.findMany.mock.calls[0][0].select
    expect(select.environmentId).toBeUndefined()
    expect(select.userId).toBe(true)
  })

  it('scopes deletes to the organization', async () => {
    const prisma = {
      apiKey: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as any
    const service = new ApiKeysService(prisma)
    await service.delete('key-1', 'org-1')
    expect(prisma.apiKey.deleteMany).toHaveBeenCalledWith({
      where: { id: 'key-1', organizationId: 'org-1' },
    })
  })
})
