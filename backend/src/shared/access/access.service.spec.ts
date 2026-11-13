import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { AccessService } from './access.service'

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const ORG_ID = 'cccccccccccccccccccccccc'
const KEY_ID = '111111111111111111111111'

const key = {
  id: KEY_ID,
  projectId: PROJECT_ID,
  organizationId: ORG_ID,
  namespace: 'translation',
  key: 'a',
}

function setup(role: string | null) {
  const prisma = {
    translationKey: { findUnique: jest.fn().mockResolvedValue(key) },
    project: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID }),
    },
    organizationMember: {
      findFirst: jest
        .fn()
        .mockResolvedValue(role ? { userId: USER_ID, role } : null),
    },
  } as any
  return { access: new AccessService(prisma), prisma }
}

describe('AccessService.assertTranslationKeyAccess', () => {
  it('returns the key for a member with the required role', async () => {
    const { access, prisma } = setup('MEMBER')
    await expect(
      access.assertTranslationKeyAccess(USER_ID, KEY_ID, 'MEMBER')
    ).resolves.toEqual({ key })
    expect(prisma.translationKey.findUnique).toHaveBeenCalledWith({
      where: { id: KEY_ID },
    })
    expect(prisma.organizationMember.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, organizationId: ORG_ID },
    })
  })

  it('throws 404 for an invalid id without querying', async () => {
    const { access, prisma } = setup('OWNER')
    await expect(
      access.assertTranslationKeyAccess(USER_ID, 'nope', 'VIEWER')
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.translationKey.findUnique).not.toHaveBeenCalled()
  })

  it('throws 404 for a missing key', async () => {
    const { access, prisma } = setup('OWNER')
    prisma.translationKey.findUnique.mockResolvedValue(null)
    await expect(
      access.assertTranslationKeyAccess(USER_ID, KEY_ID, 'VIEWER')
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('throws 404 for a non-member', async () => {
    const { access } = setup(null)
    await expect(
      access.assertTranslationKeyAccess(USER_ID, KEY_ID, 'VIEWER')
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('throws 403 for an insufficient role', async () => {
    const { access } = setup('MEMBER')
    await expect(
      access.assertTranslationKeyAccess(USER_ID, KEY_ID, 'ADMIN')
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
