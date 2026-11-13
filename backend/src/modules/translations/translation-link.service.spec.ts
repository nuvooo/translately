import { BadRequestException, NotFoundException } from '@nestjs/common'
import { TranslationLinkService } from './translation-link.service'

const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const ORG_ID = 'cccccccccccccccccccccccc'
const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const BRAND_ID = 'eeeeeeeeeeeeeeeeeeeeeeee'
const KEY_ID = '111111111111111111111111'

const keyRow = {
  id: KEY_ID,
  projectId: PROJECT_ID,
  organizationId: ORG_ID,
  namespace: 'translation',
  key: 'home.title',
  description: null,
}

function createService(
  opts: {
    standard?: string
    override?: string
    projectType?: string
    projectLanguages?: string[]
    brandLanguages?: string[]
  } = {}
) {
  const project = {
    id: PROJECT_ID,
    organizationId: ORG_ID,
    type: opts.projectType ?? 'MULTI',
    languages: opts.projectLanguages ?? ['de', 'en'],
    namespaces: ['translation'],
  }
  const prisma: any = {
    project: { findUnique: jest.fn().mockResolvedValue(project) },
    brand: {
      findFirst: jest.fn().mockResolvedValue({
        id: BRAND_ID,
        languages: opts.brandLanguages ?? ['de', 'fr'],
      }),
    },
    translationKey: { findUnique: jest.fn().mockResolvedValue(keyRow) },
    translationValue: {
      findUnique: jest.fn().mockImplementation(({ where }: any) => {
        const { scope } = where.keyId_language_scope
        const value = scope === 'default' ? opts.standard : opts.override
        return Promise.resolve(value === undefined ? null : { value })
      }),
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest
        .fn()
        .mockResolvedValue({ count: opts.override === undefined ? 0 : 1 }),
    },
  }
  const changes = { recordChange: jest.fn().mockResolvedValue(undefined) }
  const auditLogs = { create: jest.fn().mockResolvedValue({}) }
  const service = new TranslationLinkService(
    prisma,
    changes as any,
    auditLogs as any
  )
  return { service, prisma, changes, auditLogs }
}

const target = { brandId: BRAND_ID, language: 'de' }

describe('TranslationLinkService', () => {
  describe('unlink', () => {
    it('creates the override from the standard text', async () => {
      const { service, prisma, changes, auditLogs } = createService({
        standard: 'Hallo',
      })
      const cell = await service.unlink(KEY_ID, USER_ID, target)

      expect(cell).toEqual({ value: 'Hallo', inherited: false })
      expect(prisma.translationValue.create).toHaveBeenCalledWith({
        data: {
          keyId: KEY_ID,
          language: 'de',
          scope: BRAND_ID,
          projectId: PROJECT_ID,
          value: 'Hallo',
          updatedById: USER_ID,
        },
      })
      expect(changes.recordChange).toHaveBeenCalledTimes(1)
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [
          {
            key: 'home.title',
            namespace: 'translation',
            language: 'de',
            action: 'updated',
          },
        ],
      })
      expect(auditLogs.create).toHaveBeenCalledTimes(1)
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'translation.value_unlinked',
          entityType: 'TranslationKey',
          entityId: KEY_ID,
          newValues: { language: 'de', scope: BRAND_ID, value: 'Hallo' },
        })
      )
    })

    it('returns the winner of a concurrent unlink without a change', async () => {
      const { service, prisma, changes, auditLogs } = createService({
        standard: 'Hallo',
      })
      prisma.translationValue.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ value: 'Hallo' })
        .mockResolvedValueOnce({ value: 'Eigen' })
      prisma.translationValue.create.mockRejectedValue({ code: 'P2002' })

      const cell = await service.unlink(KEY_ID, USER_ID, target)

      expect(cell).toEqual({ value: 'Eigen', inherited: false })
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('keeps an existing override and writes nothing', async () => {
      const { service, prisma, changes, auditLogs } = createService({
        standard: 'Hallo',
        override: 'Eigen',
      })
      const cell = await service.unlink(KEY_ID, USER_ID, target)

      expect(cell).toEqual({ value: 'Eigen', inherited: false })
      expect(prisma.translationValue.create).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('writes nothing without a standard text', async () => {
      const { service, prisma, changes } = createService()
      const cell = await service.unlink(KEY_ID, USER_ID, target)

      expect(cell).toEqual({ value: null, inherited: false })
      expect(prisma.translationValue.create).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
    })

    it('rejects a language outside the brand list', async () => {
      const { service } = createService({ standard: 'Hallo' })
      await expect(
        service.unlink(KEY_ID, USER_ID, { brandId: BRAND_ID, language: 'en' })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects a SINGLE project', async () => {
      const { service } = createService({ projectType: 'SINGLE' })
      await expect(
        service.unlink(KEY_ID, USER_ID, target)
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('404s for an unknown brand', async () => {
      const { service, prisma } = createService()
      prisma.brand.findFirst.mockResolvedValue(null)
      await expect(
        service.unlink(KEY_ID, USER_ID, target)
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('link', () => {
    it('deletes the override and returns the inherited text', async () => {
      const { service, prisma, changes, auditLogs } = createService({
        standard: 'Hallo',
        override: 'Eigen',
      })
      const cell = await service.link(KEY_ID, USER_ID, target)

      expect(cell).toEqual({ value: 'Hallo', inherited: true })
      expect(prisma.translationValue.deleteMany).toHaveBeenCalledWith({
        where: { keyId: KEY_ID, language: 'de', scope: BRAND_ID },
      })
      expect(changes.recordChange).toHaveBeenCalledTimes(1)
      expect(changes.recordChange).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: [expect.objectContaining({ action: 'deleted' })],
        })
      )
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'translation.value_linked',
          entityType: 'TranslationKey',
          oldValues: { language: 'de', scope: BRAND_ID, value: 'Eigen' },
        })
      )
    })

    it('returns a missing cell without a standard text', async () => {
      const { service } = createService({ override: 'Eigen' })
      const cell = await service.link(KEY_ID, USER_ID, target)
      expect(cell).toEqual({ value: null, inherited: false })
    })

    it('without an override returns the same and writes nothing', async () => {
      const { service, changes, auditLogs } = createService({
        standard: 'Hallo',
      })
      const cell = await service.link(KEY_ID, USER_ID, target)

      expect(cell).toEqual({ value: 'Hallo', inherited: true })
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('rejects a language outside the brand list', async () => {
      const { service } = createService()
      await expect(
        service.link(KEY_ID, USER_ID, { brandId: BRAND_ID, language: 'en' })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects a SINGLE project', async () => {
      const { service } = createService({ projectType: 'SINGLE' })
      await expect(
        service.link(KEY_ID, USER_ID, target)
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('has nothing to inherit for a non-project language', async () => {
      const { service } = createService({
        standard: 'Salut',
        projectLanguages: ['de', 'en'],
        override: 'Eigen',
      })
      const cell = await service.link(KEY_ID, USER_ID, {
        brandId: BRAND_ID,
        language: 'fr',
      })
      expect(cell).toEqual({ value: null, inherited: false })
    })
  })
})
