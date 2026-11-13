import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ProjectsService } from './projects.service'

const mockProject = {
  id: 'proj-1',
  name: 'Test Project',
  key: 'test-project',
  description: 'A test project',
  type: 'SINGLE',
  allowedOrigins: [],
  languages: ['de', 'en'],
  namespaces: ['translation', 'admin'],
  organizationId: 'org-1',
  createdAt: new Date(),
  updatedAt: new Date(),
}

function createService() {
  const txMock = {
    brand: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    project: {
      delete: jest.fn().mockResolvedValue({}),
    },
    apiKey: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    configVersion: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    webhook: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    webhookDelivery: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    translationValue: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    translationKey: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  }

  const prisma = {
    project: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organizationMember: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation((cb: any) => cb(txMock)),
  } as any

  const changes = { recordChange: jest.fn().mockResolvedValue(undefined) }
  const service = new ProjectsService(prisma, changes as any)
  return { service, prisma, txMock, changes }
}

describe('ProjectsService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('findAll', () => {
    it('returns projects for a user', async () => {
      const { service, prisma } = createService()
      prisma.organizationMember.findMany.mockResolvedValue([
        {
          organization: {
            projects: [mockProject],
          },
        },
      ])

      const result = await service.findAll('user-1')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Test Project')
      expect(result[0]).not.toHaveProperty('environments')
      expect(result[0]).not.toHaveProperty('environmentCount')
    })

    it('returns empty when user has no memberships', async () => {
      const { service, prisma } = createService()
      prisma.organizationMember.findMany.mockResolvedValue([])

      const result = await service.findAll('user-1')

      expect(result).toHaveLength(0)
    })
  })

  describe('findOne', () => {
    it('returns the project without environment fields', async () => {
      const { service, prisma } = createService()
      prisma.project.findUnique.mockResolvedValue(mockProject)

      const result = await service.findOne('proj-1')

      expect(result.id).toBe('proj-1')
      expect(result).not.toHaveProperty('environments')
      expect(result).not.toHaveProperty('environmentCount')
    })

    it('throws when project is not found', async () => {
      const { service, prisma } = createService()
      prisma.project.findUnique.mockResolvedValue(null)

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException
      )
    })
  })

  describe('create', () => {
    it('creates a project without touching environments', async () => {
      const { service, prisma } = createService()
      prisma.organizationMember.findFirst.mockResolvedValue({
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'OWNER',
      })
      prisma.project.findUnique.mockResolvedValue(null)
      prisma.project.create.mockResolvedValue({
        ...mockProject,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await service.create('org-1', 'user-1', {
        name: 'Test Project',
        key: 'test-project',
      } as any)

      expect(result).toBeDefined()
      const call = prisma.project.create.mock.calls[0][0]
      expect(call.data).toEqual(
        expect.objectContaining({ name: 'Test Project', key: 'test-project' })
      )
      expect(call.data).not.toHaveProperty('environments')
      expect(prisma).not.toHaveProperty('environment')
    })

    it('serialises the created project as a flat JSON object', async () => {
      const { service, prisma } = createService()
      prisma.organizationMember.findFirst.mockResolvedValue({
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'OWNER',
      })
      prisma.project.findUnique.mockResolvedValue(null)
      prisma.project.create.mockResolvedValue({
        ...mockProject,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await service.create('org-1', 'user-1', {
        name: 'Test Project',
        key: 'test-project',
      } as any)

      const json = JSON.parse(JSON.stringify({ project: result })).project
      expect(json.props).toBeUndefined()
      expect(json).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: 'Test Project',
          key: 'test-project',
          type: 'SINGLE',
          organizationId: 'org-1',
        })
      )
    })

    it('throws when user has no permission', async () => {
      const { service, prisma } = createService()
      prisma.organizationMember.findFirst.mockResolvedValue(null)

      await expect(
        service.create('org-1', 'user-1', {
          name: 'Test',
          key: 'test',
        } as any)
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('throws when project key already exists', async () => {
      const { service, prisma } = createService()
      prisma.organizationMember.findFirst.mockResolvedValue({
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'OWNER',
      })
      prisma.project.findUnique.mockResolvedValue(mockProject)

      await expect(
        service.create('org-1', 'user-1', {
          name: 'Test',
          key: 'test-project',
        } as any)
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('normalizes the project key to lowercase', async () => {
      const { service, prisma } = createService()
      prisma.organizationMember.findFirst.mockResolvedValue({
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'ADMIN',
      })
      prisma.project.findUnique.mockResolvedValue(null)
      prisma.project.create.mockResolvedValue({
        ...mockProject,
        key: 'my-project',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await service.create('org-1', 'user-1', {
        name: 'My Project',
        key: '  MY-PROJECT  ',
      } as any)

      expect(prisma.project.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_key: {
            organizationId: 'org-1',
            key: 'my-project',
          },
        },
      })
    })
  })

  describe('update', () => {
    it('updates the project', async () => {
      const { service, prisma } = createService()
      prisma.project.update.mockResolvedValue({
        ...mockProject,
        name: 'Updated Name',
      })

      const result = await service.update('proj-1', { name: 'Updated Name' })

      expect(result.name).toBe('Updated Name')
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: { name: 'Updated Name' },
      })
    })

    it('ignores organizationId, key and other non-whitelisted fields', async () => {
      const { service, prisma } = createService()
      prisma.project.update.mockResolvedValue(mockProject)

      await service.update('proj-1', {
        name: 'Renamed',
        description: 'desc',
        type: 'MULTI',
        allowedOrigins: ['https://example.com'],
        organizationId: 'attacker-org',
        key: 'hijacked',
        id: 'other-id',
      } as any)

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: {
          name: 'Renamed',
          description: 'desc',
          type: 'MULTI',
          allowedOrigins: ['https://example.com'],
        },
      })
    })
  })

  describe('update (delivery version)', () => {
    // The type decides whether `?brandKey=` is honoured by the delivery, so
    // a real change must bump the version of the project.
    it.each([
      ['SINGLE', 'MULTI'],
      ['MULTI', 'SINGLE'],
    ] as const)('records one project change when the type goes from %s to %s', async (from, to) => {
      const { service, prisma, changes } = createService()
      prisma.project.findUnique.mockResolvedValue({
        type: from,
        organizationId: 'org-1',
      })
      prisma.project.update.mockResolvedValue({ ...mockProject, type: to })

      await service.update('proj-1', { type: to })

      expect(changes.recordChange).toHaveBeenCalledTimes(1)
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: 'org-1',
        projectId: 'proj-1',
        changes: [{ action: 'brand_changed' }],
      })
    })

    it('records nothing when the type is sent unchanged', async () => {
      const { service, prisma, changes } = createService()
      prisma.project.findUnique.mockResolvedValue({
        type: 'SINGLE',
        organizationId: 'org-1',
      })
      prisma.project.update.mockResolvedValue(mockProject)

      await service.update('proj-1', { type: 'SINGLE' })

      expect(changes.recordChange).not.toHaveBeenCalled()
    })

    it('records nothing for updates without a type (name, description, origins)', async () => {
      const { service, prisma, changes } = createService()
      prisma.project.findUnique.mockResolvedValue(mockProject)
      prisma.project.update.mockResolvedValue(mockProject)

      await service.update('proj-1', {
        name: 'x',
        description: 'y',
        allowedOrigins: ['https://example.com'],
      })

      expect(changes.recordChange).not.toHaveBeenCalled()
    })

    it('keeps the update when recording the change fails', async () => {
      const { service, prisma, changes } = createService()
      prisma.project.findUnique.mockResolvedValue({
        type: 'SINGLE',
        organizationId: 'org-1',
      })
      prisma.project.update.mockResolvedValue({ ...mockProject, type: 'MULTI' })
      changes.recordChange.mockRejectedValue(new Error('db down'))

      const result = await service.update('proj-1', { type: 'MULTI' })

      expect(result.type).toBe('MULTI')
    })
  })

  describe('delete', () => {
    it('deletes the project with all dependencies in a transaction', async () => {
      const { service, prisma, txMock } = createService()
      prisma.project.findUnique.mockResolvedValue(mockProject)
      prisma.organizationMember.findFirst.mockResolvedValue({
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'OWNER',
      })

      await service.delete('proj-1', 'user-1')

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(txMock.project.delete).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
      })
    })

    it('throws when project is not found', async () => {
      const { service, prisma } = createService()
      prisma.project.findUnique.mockResolvedValue(null)

      await expect(service.delete('missing', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException
      )
    })

    it('throws when user has no permission to delete', async () => {
      const { service, prisma } = createService()
      prisma.project.findUnique.mockResolvedValue(mockProject)
      prisma.organizationMember.findFirst.mockResolvedValue(null)

      await expect(service.delete('proj-1', 'user-1')).rejects.toBeInstanceOf(
        ForbiddenException
      )
    })
  })

  describe('findByOrganization', () => {
    it('returns projects for an organization', async () => {
      const { service, prisma } = createService()
      prisma.project.findMany.mockResolvedValue([mockProject])

      const result = await service.findByOrganization('org-1')

      expect(result).toHaveLength(1)
      expect(result[0]).not.toHaveProperty('environmentCount')
    })
  })
})

describe('ProjectsService project cleanup', () => {
  it('delete removes config versions, webhooks and deliveries of the project', async () => {
    const { service, prisma, txMock } = createService()
    prisma.project.findUnique.mockResolvedValue(mockProject)
    prisma.organizationMember.findFirst.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'OWNER',
    })
    txMock.webhook.findMany.mockResolvedValue([{ id: 'wh-1' }])

    await service.delete('proj-1', 'user-1')

    expect(txMock.apiKey.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1', type: 'MCP' },
    })
    expect(txMock.configVersion.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
    })
    expect(txMock.webhookDelivery.deleteMany).toHaveBeenCalledWith({
      where: { webhookId: { in: ['wh-1'] } },
    })
    expect(txMock.webhook.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
    })
  })
})

describe('ProjectsService translation cleanup', () => {
  it('delete removes the translation values and keys inside the transaction, before the project', async () => {
    const { service, prisma, txMock } = createService()
    prisma.project.findUnique.mockResolvedValue(mockProject)
    prisma.organizationMember.findFirst.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'OWNER',
    })
    const order: string[] = []
    txMock.translationValue.deleteMany.mockImplementation(async () => {
      order.push('values')
    })
    txMock.translationKey.deleteMany.mockImplementation(async () => {
      order.push('keys')
    })
    txMock.project.delete.mockImplementation(async () => {
      order.push('project')
    })

    await service.delete('proj-1', 'user-1')

    expect(txMock.translationValue.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
    })
    expect(txMock.translationKey.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
    })
    expect(order).toEqual(['values', 'keys', 'project'])
  })
})

describe('ProjectsService responses include languages and namespaces', () => {
  const fields = {
    languages: ['de', 'en'],
    namespaces: ['translation', 'admin'],
  }

  it('findAll, findOne, findByOrganization and update', async () => {
    const { service, prisma } = createService()
    prisma.organizationMember.findMany.mockResolvedValue([
      { organization: { projects: [mockProject] } },
    ])
    prisma.project.findUnique.mockResolvedValue(mockProject)
    prisma.project.findMany.mockResolvedValue([mockProject])
    prisma.project.update.mockResolvedValue(mockProject)

    const [listed] = await service.findAll('user-1')
    const one = await service.findOne('proj-1')
    const [byOrg] = await service.findByOrganization('org-1')
    const updated = await service.update('proj-1', { name: 'x' })

    for (const project of [listed, one, byOrg, updated]) {
      expect(project).toEqual(expect.objectContaining(fields))
    }
  })

  it('create serialises the stored languages and namespaces', async () => {
    const { service, prisma } = createService()
    prisma.organizationMember.findFirst.mockResolvedValue({ role: 'OWNER' })
    prisma.project.findUnique.mockResolvedValue(null)
    prisma.project.create.mockResolvedValue({
      ...mockProject,
      languages: [],
      namespaces: ['translation'],
    })

    const result = await service.create('org-1', 'user-1', {
      name: 'Test Project',
      key: 'test-project',
    } as any)

    expect(result.languages).toEqual([])
    expect(result.namespaces).toEqual(['translation'])
    const json = JSON.parse(JSON.stringify(result))
    expect(json.languages).toEqual([])
    expect(json.namespaces).toEqual(['translation'])
  })
})
