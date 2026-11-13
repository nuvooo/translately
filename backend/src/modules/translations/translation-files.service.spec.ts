import { Project } from '@prisma/client'
import { TranslationFilesService } from './translation-files.service'

const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const BRAND_ID = 'eeeeeeeeeeeeeeeeeeeeeeee'

const project = {
  id: PROJECT_ID,
  organizationId: 'cccccccccccccccccccccccc',
  type: 'MULTI',
  languages: ['de', 'en'],
  namespaces: ['translation', 'admin'],
} as unknown as Project

const keyRows = [
  { id: 'k1', key: 'a' },
  { id: 'k2', key: 'b' },
]

function value(keyId: string, scope: string, text: string) {
  return { keyId, scope, value: text }
}

function createService(
  values: Array<{ keyId: string; scope: string; value: string }> = [],
  brand: { id: string; languages: string[] } | null = {
    id: BRAND_ID,
    languages: ['de', 'fr'],
  }
) {
  const prisma: any = {
    brand: { findFirst: jest.fn().mockResolvedValue(brand) },
    translationKey: { findMany: jest.fn().mockResolvedValue(keyRows) },
    translationValue: { findMany: jest.fn().mockResolvedValue(values) },
  }
  return { service: new TranslationFilesService(prisma), prisma }
}

const input = (
  overrides: Partial<{
    namespace: string
    language: string
    brandId: string | null
  }> = {}
) => ({
  project,
  namespace: 'translation',
  language: 'de',
  brandId: null,
  ...overrides,
})

describe('TranslationFilesService.getFile', () => {
  it('returns the default file of the namespace and language', async () => {
    const { service, prisma } = createService([
      value('k1', 'default', 'A'),
      value('k2', 'default', 'B'),
    ])

    const file = await service.getFile(input())

    expect({ ...file }).toEqual({ a: 'A', b: 'B' })
    expect(prisma.translationKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, namespace: 'translation' },
      })
    )
    expect(prisma.translationValue.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.translationValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: PROJECT_ID,
          language: 'de',
          scope: { in: ['default'] },
          keyId: { in: ['k1', 'k2'] },
        },
      })
    )
    expect(prisma.brand.findFirst).not.toHaveBeenCalled()
  })

  it('merges a brand override over the default text', async () => {
    const { service, prisma } = createService([
      value('k1', 'default', 'A'),
      value('k2', 'default', 'B'),
      value('k2', BRAND_ID, 'Brand B'),
    ])

    const file = await service.getFile(input({ brandId: BRAND_ID }))

    expect({ ...file }).toEqual({ a: 'A', b: 'Brand B' })
    expect(prisma.brand.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BRAND_ID, projectId: PROJECT_ID },
      })
    )
    expect(prisma.translationValue.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.translationValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: PROJECT_ID,
          scope: { in: ['default', BRAND_ID] },
        }),
      })
    )
  })

  it('returns {} without querying values when the brand lacks the language', async () => {
    const { service, prisma } = createService([value('k1', 'default', 'A')])

    const file = await service.getFile(
      input({ brandId: BRAND_ID, language: 'en' })
    )

    expect({ ...file }).toEqual({})
    expect(prisma.translationValue.findMany).not.toHaveBeenCalled()
  })

  it('returns {} without querying values for an unknown brand', async () => {
    const { service, prisma } = createService([], null)

    const file = await service.getFile(input({ brandId: BRAND_ID }))

    expect({ ...file }).toEqual({})
    expect(prisma.translationValue.findMany).not.toHaveBeenCalled()
  })

  it('serves only the brand texts for a language the project does not have', async () => {
    const { service, prisma } = createService([
      value('k1', BRAND_ID, 'Brand A'),
    ])

    const file = await service.getFile(
      input({ brandId: BRAND_ID, language: 'fr' })
    )

    expect({ ...file }).toEqual({ a: 'Brand A' })
    expect(prisma.translationValue.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.translationValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          language: 'fr',
          scope: { in: [BRAND_ID] },
        }),
      })
    )
  })

  it('returns {} without any query for an unknown namespace', async () => {
    const { service, prisma } = createService([value('k1', 'default', 'A')])

    const file = await service.getFile(input({ namespace: 'unknown' }))

    expect({ ...file }).toEqual({})
    expect(prisma.translationKey.findMany).not.toHaveBeenCalled()
    expect(prisma.translationValue.findMany).not.toHaveBeenCalled()
  })

  it('returns {} without querying values for a language the project does not have (default view)', async () => {
    const { service, prisma } = createService([value('k1', 'default', 'A')])

    const file = await service.getFile(input({ language: 'pt-br' }))

    expect({ ...file }).toEqual({})
    expect(prisma.translationValue.findMany).not.toHaveBeenCalled()
  })

  it('compares languages case-sensitively', async () => {
    const { service, prisma } = createService([value('k1', 'default', 'A')])

    const file = await service.getFile(input({ language: 'DE' }))

    expect({ ...file }).toEqual({})
    expect(prisma.translationValue.findMany).not.toHaveBeenCalled()
  })

  it('ignores values of keys outside the namespace', async () => {
    const { service } = createService([
      value('k1', 'default', 'A'),
      value('foreign', 'default', 'X'),
    ])

    const file = await service.getFile(input())

    expect({ ...file }).toEqual({ a: 'A' })
  })

  it('returns {} without querying values when the namespace has no keys', async () => {
    const { service, prisma } = createService()
    prisma.translationKey.findMany.mockResolvedValue([])

    const file = await service.getFile(input())

    expect({ ...file }).toEqual({})
    expect(prisma.translationValue.findMany).not.toHaveBeenCalled()
  })
})
