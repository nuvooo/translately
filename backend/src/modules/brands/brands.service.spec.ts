import { NotFoundException } from '@nestjs/common'
import { BrandsService } from './brands.service'

const mockBrand = {
  id: 'brand-1',
  name: 'Brand A',
  key: 'brand-a',
  description: 'Test brand',
  projectId: 'proj-1',
  languages: ['de', 'fr'],
}

function createService() {
  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
    },
    brand: {
      findMany: jest.fn(),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'brand-1', projectId: 'proj-1' }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    translationValue: {
      deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
    },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  } as any

  const changes = {
    recordChange: jest.fn().mockResolvedValue(undefined),
  } as any
  const service = new BrandsService(prisma, changes)
  return { service, prisma, changes }
}


describe('BrandsService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('findByProject', () => {
    it('returns brands for a project', async () => {
      const { service, prisma } = createService()
      prisma.brand.findMany.mockResolvedValue([mockBrand])

      const result = await service.findByProject('proj-1')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Brand A')
    })
  })


  describe('create', () => {
    it('creates a new brand', async () => {
      const { service, prisma } = createService()
      prisma.brand.create.mockResolvedValue(mockBrand)

      const result = await service.create('proj-1', {
        name: 'Brand A',
        key: 'brand-a',
        description: 'Test brand',
      })

      expect(result.name).toBe('Brand A')
      expect(prisma.brand.create).toHaveBeenCalledWith({
        data: {
          name: 'Brand A',
          key: 'brand-a',
          description: 'Test brand',
          projectId: 'proj-1',
        },
      })
    })
  })

  describe('update', () => {
    it('updates the brand', async () => {
      const { service, prisma } = createService()
      prisma.brand.update.mockResolvedValue({
        ...mockBrand,
        name: 'Updated Brand',
      })

      const result = await service.update('brand-1', { name: 'Updated Brand' })

      expect(result.name).toBe('Updated Brand')
    })

    it('only forwards whitelisted fields to prisma', async () => {
      const { service, prisma } = createService()
      prisma.brand.update.mockResolvedValue(mockBrand)

      await service.update('brand-1', {
        name: 'Renamed',
        projectId: 'other-project',
        key: 'hijacked',
      } as any)

      expect(prisma.brand.update).toHaveBeenCalledWith({
        where: { id: 'brand-1' },
        data: { name: 'Renamed' },
      })
    })
  })

  describe('delete', () => {
    it('deletes the brand', async () => {
      const { service, prisma } = createService()
      prisma.brand.delete.mockResolvedValue({})

      await service.delete('brand-1')

      expect(prisma.brand.delete).toHaveBeenCalledWith({
        where: { id: 'brand-1' },
      })
    })

    it('deletes the brand texts (scope = brandId) of its project together with the brand', async () => {
      const { service, prisma } = createService()
      prisma.brand.delete.mockResolvedValue(mockBrand)

      await service.delete('brand-1')

      expect(prisma.translationValue.deleteMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1', scope: 'brand-1' },
      })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      const ops = prisma.$transaction.mock.calls[0][0]
      expect(ops).toHaveLength(2)
    })

    it('throws 404 and deletes nothing for an unknown brand', async () => {
      const { service, prisma } = createService()
      prisma.brand.findUnique.mockResolvedValue(null)

      await expect(service.delete('brand-x')).rejects.toBeInstanceOf(
        NotFoundException
      )
      expect(prisma.translationValue.deleteMany).not.toHaveBeenCalled()
      expect(prisma.brand.delete).not.toHaveBeenCalled()
    })
  })

  describe('responses include languages', () => {
    it('findByProject, create and update return the full brand rows', async () => {
      const { service, prisma } = createService()
      prisma.brand.findMany.mockResolvedValue([mockBrand])
      prisma.brand.create.mockResolvedValue(mockBrand)
      prisma.brand.update.mockResolvedValue(mockBrand)

      const [listed] = await service.findByProject('proj-1')
      const created = await service.create('proj-1', {
        name: 'Brand A',
        key: 'brand-a',
      })
      const updated = await service.update('brand-1', { name: 'Brand A' })

      for (const brand of [listed, created, updated]) {
        expect(brand.languages).toEqual(['de', 'fr'])
      }
      // No select: every scalar field (incl. languages) is returned
      expect(prisma.brand.findMany.mock.calls[0][0].select).toBeUndefined()
      expect(prisma.brand.create.mock.calls[0][0].select).toBeUndefined()
      expect(prisma.brand.update.mock.calls[0][0].select).toBeUndefined()
    })
  })
})

describe('BrandsService change events', () => {
  const brandChanged = {
    organizationId: 'org-1',
    projectId: 'proj-1',
    changes: [{ action: 'brand_changed' }],
  }

  it('create records brand_changed for the project', async () => {
    const { service, prisma, changes } = createService()
    prisma.brand.create.mockResolvedValue(mockBrand)

    await service.create('proj-1', { name: 'Brand A', key: 'brand-a' })

    expect(prisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      select: { organizationId: true },
    })
    expect(changes.recordChange).toHaveBeenCalledWith(brandChanged)
  })

  it('create records nothing when the write fails', async () => {
    const { service, prisma, changes } = createService()
    prisma.brand.create.mockRejectedValue(new Error('duplicate'))

    await expect(
      service.create('proj-1', { name: 'Brand A', key: 'brand-a' })
    ).rejects.toThrow()
    expect(changes.recordChange).not.toHaveBeenCalled()
  })

  it('create still succeeds when the organization lookup fails', async () => {
    const { service, prisma, changes } = createService()
    prisma.brand.create.mockResolvedValue(mockBrand)
    prisma.project.findUnique.mockRejectedValue(new Error('db down'))

    await expect(
      service.create('proj-1', { name: 'Brand A', key: 'brand-a' })
    ).resolves.toEqual(mockBrand)
    expect(changes.recordChange).not.toHaveBeenCalled()
  })

  it('update records brand_changed for the project', async () => {
    const { service, prisma, changes } = createService()
    prisma.brand.update.mockResolvedValue(mockBrand)

    await service.update('brand-1', { name: 'Renamed' })

    expect(changes.recordChange).toHaveBeenCalledWith(brandChanged)
  })

  it('update records nothing when the write fails', async () => {
    const { service, prisma, changes } = createService()
    prisma.brand.update.mockRejectedValue(new Error('x'))

    await expect(service.update('brand-1', { name: 'R' })).rejects.toThrow()
    expect(changes.recordChange).not.toHaveBeenCalled()
  })

  it('delete records brand_changed for the project', async () => {
    const { service, prisma, changes } = createService()
    prisma.brand.delete.mockResolvedValue(mockBrand)

    await service.delete('brand-1')

    expect(changes.recordChange).toHaveBeenCalledWith(brandChanged)
  })

  it('delete records nothing when the write fails', async () => {
    const { service, prisma, changes } = createService()
    prisma.brand.delete.mockRejectedValue(new Error('x'))

    await expect(service.delete('brand-1')).rejects.toThrow()
    expect(changes.recordChange).not.toHaveBeenCalled()
  })
})
