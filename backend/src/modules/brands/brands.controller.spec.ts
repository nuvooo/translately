import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { AccessService } from '../../shared/access/access.service'
import { BrandsController } from './brands.controller'
import { BrandsService } from './brands.service'

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const ORG_ID = 'cccccccccccccccccccccccc'
const BRAND_ID = '111111111111111111111111'

const req = { user: { userId: USER_ID } }

function setup(role: string | null) {
  const prisma = {
    project: {
      findUnique: jest.fn().mockImplementation(({ where }: any) => ({
        id: where.id,
        organizationId: ORG_ID,
      })),
    },
    brand: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: BRAND_ID, projectId: PROJECT_ID }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organizationMember: {
      findFirst: jest
        .fn()
        .mockResolvedValue(role ? { userId: USER_ID, role } : null),
    },
  } as any
  const access = new AccessService(prisma)
  const changes = {
    recordChange: jest.fn().mockResolvedValue(undefined),
  } as any
  const service = new BrandsService(prisma, changes)
  const controller = new BrandsController(service, access)
  return { controller, prisma }
}

describe('BrandsController (access control)', () => {
  it.each([
    [
      'findByProject',
      (c: BrandsController) => c.findByProject(PROJECT_ID, req),
    ],
    [
      'create',
      (c: BrandsController) =>
        c.create(PROJECT_ID, { name: 'Brand', key: 'brand' }, req),
    ],
    ['update', (c: BrandsController) => c.update(BRAND_ID, { name: 'x' }, req)],
    ['delete', (c: BrandsController) => c.delete(BRAND_ID, req)],
  ])('%s rejects non-members with 404', async (_name, call) => {
    const { controller, prisma } = setup(null)
    await expect(call(controller)).rejects.toThrow(NotFoundException)
    expect(prisma.brand.findMany).not.toHaveBeenCalled()
    expect(prisma.brand.create).not.toHaveBeenCalled()
    expect(prisma.brand.update).not.toHaveBeenCalled()
    expect(prisma.brand.delete).not.toHaveBeenCalled()
  })

  it('requires ADMIN for brand CRUD', async () => {
    const { controller, prisma } = setup('MEMBER')
    await expect(
      controller.create(PROJECT_ID, { name: 'Brand', key: 'brand' }, req)
    ).rejects.toThrow(ForbiddenException)
    await expect(
      controller.update(BRAND_ID, { name: 'x' }, req)
    ).rejects.toThrow(ForbiddenException)
    await expect(controller.delete(BRAND_ID, req)).rejects.toThrow(
      ForbiddenException
    )
    expect(prisma.brand.create).not.toHaveBeenCalled()
    expect(prisma.brand.update).not.toHaveBeenCalled()
    expect(prisma.brand.delete).not.toHaveBeenCalled()
  })
})
