import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { MAX_LANGUAGES, MAX_NAMESPACES } from './limits'
import { TranslationSettingsService } from './translation-settings.service'

const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const ORG_ID = 'cccccccccccccccccccccccc'
const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const BRAND_ID = 'eeeeeeeeeeeeeeeeeeeeeeee'

function createService(
  project: Record<string, unknown> = {},
  brand: Record<string, unknown> | null = {}
) {
  const projectRow = {
    id: PROJECT_ID,
    organizationId: ORG_ID,
    type: 'MULTI',
    languages: ['de', 'en'],
    namespaces: ['translation', 'admin'],
    ...project,
  }
  const brandRow =
    brand === null
      ? null
      : {
          id: BRAND_ID,
          projectId: PROJECT_ID,
          languages: ['de', 'fr'],
          project: { organizationId: ORG_ID, type: projectRow.type },
          ...brand,
        }
  const prisma: any = {
    project: {
      findUnique: jest.fn().mockResolvedValue(projectRow),
      update: jest.fn().mockImplementation(({ data }: any) => ({
        ...projectRow,
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]: [string, any]) => [k, v.set ?? v])
        ),
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    brand: {
      findUnique: jest.fn().mockResolvedValue(brandRow),
      update: jest.fn().mockImplementation(({ data }: any) => ({
        ...brandRow,
        languages: data.languages.set,
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    translationKey: {
      findMany: jest.fn().mockResolvedValue([{ id: 'k1' }, { id: 'k2' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    translationValue: {
      deleteMany: jest.fn().mockResolvedValue({ count: 7 }),
    },
    $runCommandRaw: jest.fn().mockResolvedValue({ ok: 1, n: 0 }),
    // Batch (array) and interactive (callback) transactions.
    $transaction: jest
      .fn()
      .mockImplementation((ops: any) =>
        typeof ops === 'function' ? ops(prisma) : Promise.all(ops)
      ),
  }
  const changes = { recordChange: jest.fn().mockResolvedValue(undefined) }
  const auditLogs = { create: jest.fn().mockResolvedValue({}) }
  const service = new TranslationSettingsService(
    prisma,
    changes as any,
    auditLogs as any
  )
  return { service, prisma, changes, auditLogs }
}

describe('TranslationSettingsService', () => {
  describe('setProjectLanguages', () => {
    it('stores the list and records languages_changed', async () => {
      const { service, prisma, changes, auditLogs } = createService({
        languages: ['de'],
      })

      const result = await service.setProjectLanguages(PROJECT_ID, USER_ID, [
        'de',
        'en',
      ])

      expect(result).toEqual({ languages: ['de', 'en'], removedValues: 0 })
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: PROJECT_ID },
        data: { languages: { set: ['de', 'en'] } },
      })
      expect(prisma.translationValue.deleteMany).not.toHaveBeenCalled()
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [{ action: 'languages_changed', language: 'en' }],
      })
      expect(auditLogs.create).toHaveBeenCalledWith({
        action: 'translation.languages_changed',
        entityType: 'Project',
        entityId: PROJECT_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        oldValues: { languages: ['de'] },
        newValues: { languages: ['de', 'en'] },
      })
    })

    it('merges duplicates (exact match) and keeps the input order', async () => {
      const { service, prisma } = createService({ languages: [] })

      const result = await service.setProjectLanguages(PROJECT_ID, USER_ID, [
        'en',
        'de',
        'en',
        'de-DE',
        'de',
        'DE',
      ])

      expect(result.languages).toEqual(['en', 'de', 'de-DE', 'DE'])
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: PROJECT_ID },
        data: { languages: { set: ['en', 'de', 'de-DE', 'DE'] } },
      })
    })

    it('rejects an invalid language code with 400', async () => {
      const { service, prisma } = createService()
      await expect(
        service.setProjectLanguages(PROJECT_ID, USER_ID, ['de', 'd'])
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.setProjectLanguages(PROJECT_ID, USER_ID, ['de', 'de_DE'])
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.setProjectLanguages(PROJECT_ID, USER_ID, [42 as any])
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.setProjectLanguages(PROJECT_ID, USER_ID, 'de' as any)
      ).rejects.toThrow(BadRequestException)
      expect(prisma.project.update).not.toHaveBeenCalled()
    })

    it('allows at most MAX_LANGUAGES after de-duplication', async () => {
      const { service, prisma } = createService({ languages: [] })
      const codes = Array.from(
        { length: MAX_LANGUAGES },
        (_, i) =>
          `l${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`
      )

      await expect(
        service.setProjectLanguages(PROJECT_ID, USER_ID, [...codes, codes[0]])
      ).resolves.toEqual({ languages: codes, removedValues: 0 })
      await expect(
        service.setProjectLanguages(PROJECT_ID, USER_ID, [...codes, 'zzz'])
      ).rejects.toThrow(BadRequestException)
      expect(prisma.project.update).toHaveBeenCalledTimes(1)
    })

    it('removed project language deletes its default texts in one transaction', async () => {
      const { service, prisma, changes } = createService({
        languages: ['de', 'en', 'fr'],
      })

      const result = await service.setProjectLanguages(PROJECT_ID, USER_ID, [
        'de',
        'fr',
      ])

      expect(result).toEqual({ languages: ['de', 'fr'], removedValues: 7 })
      expect(prisma.translationValue.deleteMany).toHaveBeenCalledWith({
        where: {
          projectId: PROJECT_ID,
          scope: 'default',
          language: { in: ['en'] },
        },
      })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2)
      expect(changes.recordChange).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: [{ action: 'languages_changed', language: 'en' }],
        })
      )
    })

    it('keeps brand texts when the project removes a language', async () => {
      const { service, prisma } = createService({ languages: ['de', 'en'] })

      await service.setProjectLanguages(PROJECT_ID, USER_ID, ['de'])

      expect(prisma.translationValue.deleteMany).toHaveBeenCalledTimes(1)
      const where = prisma.translationValue.deleteMany.mock.calls[0][0].where
      expect(where.scope).toBe('default')
      expect(where.projectId).toBe(PROJECT_ID)
    })

    it('reordering deletes nothing and records no language', async () => {
      const { service, prisma, changes } = createService({
        languages: ['de', 'en'],
      })

      const result = await service.setProjectLanguages(PROJECT_ID, USER_ID, [
        'en',
        'de',
      ])

      expect(result).toEqual({ languages: ['en', 'de'], removedValues: 0 })
      expect(prisma.translationValue.deleteMany).not.toHaveBeenCalled()
      expect(changes.recordChange).toHaveBeenCalledWith(
        expect.objectContaining({ changes: [{ action: 'languages_changed' }] })
      )
    })

    it('omits the language when more than one language changed', async () => {
      const { service, changes } = createService({ languages: ['de'] })

      await service.setProjectLanguages(PROJECT_ID, USER_ID, ['en', 'fr'])

      expect(changes.recordChange).toHaveBeenCalledWith(
        expect.objectContaining({ changes: [{ action: 'languages_changed' }] })
      )
    })

    it('writes and records nothing when the list is unchanged', async () => {
      const { service, prisma, changes, auditLogs } = createService({
        languages: ['de', 'en'],
      })

      const result = await service.setProjectLanguages(PROJECT_ID, USER_ID, [
        'de',
        'en',
        'de',
      ])

      expect(result).toEqual({ languages: ['de', 'en'], removedValues: 0 })
      expect(prisma.project.update).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('an empty list removes all languages and their default texts', async () => {
      const { service, prisma } = createService({ languages: ['de', 'en'] })

      const result = await service.setProjectLanguages(PROJECT_ID, USER_ID, [])

      expect(result).toEqual({ languages: [], removedValues: 7 })
      expect(prisma.translationValue.deleteMany).toHaveBeenCalledWith({
        where: {
          projectId: PROJECT_ID,
          scope: 'default',
          language: { in: ['de', 'en'] },
        },
      })
    })

    it('throws 404 for an unknown project', async () => {
      const { service, prisma } = createService()
      prisma.project.findUnique.mockResolvedValue(null)
      await expect(
        service.setProjectLanguages(PROJECT_ID, USER_ID, ['de'])
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('setBrandLanguages', () => {
    it('stores an independent list (codes the project does not have are allowed)', async () => {
      const { service, prisma, changes, auditLogs } = createService(
        {},
        { languages: ['de'] }
      )

      const result = await service.setBrandLanguages(BRAND_ID, USER_ID, [
        'de',
        'it',
      ])

      expect(result).toEqual({ languages: ['de', 'it'], removedValues: 0 })
      expect(prisma.brand.update).toHaveBeenCalledWith({
        where: { id: BRAND_ID },
        data: { languages: { set: ['de', 'it'] } },
      })
      expect(prisma.project.update).not.toHaveBeenCalled()
      expect(prisma.translationValue.deleteMany).not.toHaveBeenCalled()
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [{ action: 'languages_changed', language: 'it' }],
      })
      expect(auditLogs.create).toHaveBeenCalledWith({
        action: 'translation.languages_changed',
        entityType: 'Brand',
        entityId: BRAND_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        oldValues: { languages: ['de'] },
        newValues: { languages: ['de', 'it'] },
      })
    })

    it('removed brand language deletes only that brand texts in that language', async () => {
      const { service, prisma } = createService({}, { languages: ['de', 'fr'] })

      const result = await service.setBrandLanguages(BRAND_ID, USER_ID, ['de'])

      expect(result).toEqual({ languages: ['de'], removedValues: 7 })
      expect(prisma.translationValue.deleteMany).toHaveBeenCalledWith({
        where: {
          projectId: PROJECT_ID,
          scope: BRAND_ID,
          language: { in: ['fr'] },
        },
      })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })

    it('merges duplicates and rejects invalid codes', async () => {
      const { service } = createService({}, { languages: [] })
      await expect(
        service.setBrandLanguages(BRAND_ID, USER_ID, ['fr', 'fr', 'de'])
      ).resolves.toEqual({ languages: ['fr', 'de'], removedValues: 0 })
      await expect(
        service.setBrandLanguages(BRAND_ID, USER_ID, ['x'])
      ).rejects.toThrow(BadRequestException)
    })

    it('writes nothing when the list is unchanged', async () => {
      const { service, prisma, changes } = createService(
        {},
        { languages: ['de', 'fr'] }
      )
      await expect(
        service.setBrandLanguages(BRAND_ID, USER_ID, ['de', 'fr'])
      ).resolves.toEqual({ languages: ['de', 'fr'], removedValues: 0 })
      expect(prisma.brand.update).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
    })

    it('rejects brands of a SINGLE project with 400', async () => {
      const { service, prisma } = createService({ type: 'SINGLE' })
      await expect(
        service.setBrandLanguages(BRAND_ID, USER_ID, ['de'])
      ).rejects.toThrow(BadRequestException)
      expect(prisma.brand.update).not.toHaveBeenCalled()
    })

    it('throws 404 for an unknown brand', async () => {
      const { service } = createService({}, null)
      await expect(
        service.setBrandLanguages(BRAND_ID, USER_ID, ['de'])
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('addNamespace', () => {
    it('appends the namespace, records created and audits', async () => {
      const { service, prisma, changes, auditLogs } = createService()

      const result = await service.addNamespace(PROJECT_ID, USER_ID, 'shop')

      expect(result).toEqual({ namespaces: ['translation', 'admin', 'shop'] })
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: PROJECT_ID },
        data: { namespaces: { set: ['translation', 'admin', 'shop'] } },
      })
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [{ namespace: 'shop', action: 'created' }],
      })
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'translation.namespace_added',
          entityType: 'Project',
          entityId: PROJECT_ID,
          newValues: { namespace: 'shop' },
        })
      )
    })

    it('is idempotent for an existing namespace', async () => {
      const { service, prisma, changes, auditLogs } = createService()

      const result = await service.addNamespace(PROJECT_ID, USER_ID, 'admin')

      expect(result).toEqual({ namespaces: ['translation', 'admin'] })
      expect(prisma.project.update).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('rejects an invalid namespace with 400', async () => {
      const { service, prisma } = createService()
      await expect(
        service.addNamespace(PROJECT_ID, USER_ID, 'a b')
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.addNamespace(PROJECT_ID, USER_ID, '')
      ).rejects.toThrow(BadRequestException)
      expect(prisma.project.update).not.toHaveBeenCalled()
    })

    it('rejects more than MAX_NAMESPACES with 400', async () => {
      const full = Array.from({ length: MAX_NAMESPACES }, (_, i) => `ns${i}`)
      const { service, prisma } = createService({ namespaces: full })
      await expect(
        service.addNamespace(PROJECT_ID, USER_ID, 'one-more')
      ).rejects.toThrow(BadRequestException)
      expect(prisma.project.update).not.toHaveBeenCalled()
    })
  })

  describe('removeNamespace', () => {
    it('refuses a namespace that contains a locked key with 409', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue([
        { id: 'k1', locked: true },
        { id: 'k2' },
      ])

      await expect(
        service.removeNamespace(PROJECT_ID, USER_ID, 'admin')
      ).rejects.toThrow(ConflictException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(prisma.translationKey.deleteMany).not.toHaveBeenCalled()
    })

    it('deletes the namespace keys and their values with the project update in one transaction', async () => {
      const { service, prisma, changes, auditLogs } = createService()

      const result = await service.removeNamespace(PROJECT_ID, USER_ID, 'admin')

      expect(result).toEqual({ namespaces: ['translation'], removedKeys: 2 })
      expect(prisma.translationKey.findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID, namespace: 'admin' },
        select: { id: true, locked: true },
      })
      expect(prisma.translationValue.deleteMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID, keyId: { in: ['k1', 'k2'] } },
      })
      expect(prisma.translationKey.deleteMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID, namespace: 'admin' },
      })
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: PROJECT_ID },
        data: { namespaces: { set: ['translation'] } },
      })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(3)
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [{ namespace: 'admin', action: 'deleted' }],
      })
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'translation.namespace_removed',
          entityType: 'Project',
          entityId: PROJECT_ID,
          oldValues: { namespace: 'admin', removedKeys: 2 },
        })
      )
    })

    it("refuses to remove 'translation' with 400", async () => {
      const { service, prisma } = createService()
      await expect(
        service.removeNamespace(PROJECT_ID, USER_ID, 'translation')
      ).rejects.toThrow(BadRequestException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('throws 404 for a namespace the project does not have', async () => {
      const { service, prisma } = createService()
      await expect(
        service.removeNamespace(PROJECT_ID, USER_ID, 'shop')
      ).rejects.toThrow(NotFoundException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('expected list (stale list protection)', () => {
    const STALE = 'Die Sprachliste wurde inzwischen geändert'

    it('project: a matching expected list writes conditionally and deletes in one transaction', async () => {
      const { service, prisma, changes, auditLogs } = createService({
        languages: ['de', 'en', 'fr'],
      })

      const result = await service.setProjectLanguages(
        PROJECT_ID,
        USER_ID,
        ['de'],
        ['de', 'en', 'fr']
      )

      expect(result).toEqual({ languages: ['de'], removedValues: 7 })
      expect(prisma.project.updateMany).toHaveBeenCalledWith({
        where: { id: PROJECT_ID, languages: { equals: ['de', 'en', 'fr'] } },
        data: { languages: { set: ['de'] } },
      })
      expect(prisma.project.update).not.toHaveBeenCalled()
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(typeof prisma.$transaction.mock.calls[0][0]).toBe('function')
      expect(prisma.translationValue.deleteMany).toHaveBeenCalledWith({
        where: {
          projectId: PROJECT_ID,
          scope: 'default',
          language: { in: ['en', 'fr'] },
        },
      })
      expect(changes.recordChange).toHaveBeenCalled()
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          oldValues: { languages: ['de', 'en', 'fr'] },
          newValues: { languages: ['de'] },
        })
      )
    })

    it('project: a pure addition with a matching expected list is also conditional', async () => {
      const { service, prisma } = createService({ languages: ['de'] })

      const result = await service.setProjectLanguages(
        PROJECT_ID,
        USER_ID,
        ['de', 'en'],
        ['de']
      )

      expect(result).toEqual({ languages: ['de', 'en'], removedValues: 0 })
      expect(prisma.project.updateMany).toHaveBeenCalledWith({
        where: { id: PROJECT_ID, languages: { equals: ['de'] } },
        data: { languages: { set: ['de', 'en'] } },
      })
      expect(prisma.translationValue.deleteMany).not.toHaveBeenCalled()
    })

    it.each([
      [
        'an extra language in the stored list',
        ['de', 'en', 'fr'],
        ['de', 'en'],
      ],
      ['a different order', ['en', 'de'], ['de', 'en']],
      ['a different case', ['de', 'EN'], ['de', 'en']],
    ])('project: 409 and no change for %s', async (_case, stored, expected) => {
      const { service, prisma, changes, auditLogs } = createService({
        languages: stored,
      })

      const call = service.setProjectLanguages(
        PROJECT_ID,
        USER_ID,
        ['de'],
        expected
      )

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toThrow(STALE)
      expect(prisma.project.update).not.toHaveBeenCalled()
      expect(prisma.project.updateMany).not.toHaveBeenCalled()
      expect(prisma.translationValue.deleteMany).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('project: a change between read and write (conditional write matches nothing) aborts before deleting', async () => {
      const { service, prisma, changes, auditLogs } = createService({
        languages: ['de', 'en'],
      })
      prisma.project.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.setProjectLanguages(PROJECT_ID, USER_ID, ['de'], ['de', 'en'])
      ).rejects.toThrow(new ConflictException(STALE))

      expect(prisma.project.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PROJECT_ID, languages: { equals: ['de', 'en'] } },
        })
      )
      expect(prisma.translationValue.deleteMany).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('project: without expected the write is unconditional as before', async () => {
      const { service, prisma } = createService({ languages: ['de', 'en'] })

      await service.setProjectLanguages(PROJECT_ID, USER_ID, ['de'])

      expect(prisma.project.updateMany).not.toHaveBeenCalled()
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: PROJECT_ID },
        data: { languages: { set: ['de'] } },
      })
    })

    it('brand: a matching expected list writes conditionally and deletes the brand texts', async () => {
      const { service, prisma } = createService({}, { languages: ['de', 'fr'] })

      const result = await service.setBrandLanguages(
        BRAND_ID,
        USER_ID,
        ['de'],
        ['de', 'fr']
      )

      expect(result).toEqual({ languages: ['de'], removedValues: 7 })
      expect(prisma.brand.updateMany).toHaveBeenCalledWith({
        where: { id: BRAND_ID, languages: { equals: ['de', 'fr'] } },
        data: { languages: { set: ['de'] } },
      })
      expect(prisma.brand.update).not.toHaveBeenCalled()
      expect(prisma.translationValue.deleteMany).toHaveBeenCalledWith({
        where: {
          projectId: PROJECT_ID,
          scope: BRAND_ID,
          language: { in: ['fr'] },
        },
      })
    })

    it.each([
      [
        'an extra language in the stored list',
        ['de', 'fr', 'it'],
        ['de', 'fr'],
      ],
      ['a different order', ['fr', 'de'], ['de', 'fr']],
      ['a different case', ['de', 'FR'], ['de', 'fr']],
    ])('brand: 409 and no change for %s', async (_case, stored, expected) => {
      const { service, prisma, changes, auditLogs } = createService(
        {},
        { languages: stored }
      )

      await expect(
        service.setBrandLanguages(BRAND_ID, USER_ID, ['de'], expected)
      ).rejects.toThrow(new ConflictException(STALE))

      expect(prisma.brand.update).not.toHaveBeenCalled()
      expect(prisma.brand.updateMany).not.toHaveBeenCalled()
      expect(prisma.translationValue.deleteMany).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('brand: a change between read and write aborts before deleting', async () => {
      const { service, prisma, changes, auditLogs } = createService(
        {},
        { languages: ['de', 'fr'] }
      )
      prisma.brand.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.setBrandLanguages(BRAND_ID, USER_ID, ['de'], ['de', 'fr'])
      ).rejects.toBeInstanceOf(ConflictException)

      expect(prisma.translationValue.deleteMany).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('brand: without expected the write is unconditional as before', async () => {
      const { service, prisma } = createService({}, { languages: ['de', 'fr'] })

      await service.setBrandLanguages(BRAND_ID, USER_ID, ['de'])

      expect(prisma.brand.updateMany).not.toHaveBeenCalled()
      expect(prisma.brand.update).toHaveBeenCalled()
    })
  })

  describe('expected list hardening', () => {
    const STALE = 'Die Sprachliste wurde inzwischen geändert'
    const EMPTY_WHERE = {
      OR: [{ languages: { equals: [] } }, { languages: { equals: null } }],
    }

    it('project: an empty expected list back-fills a missing field and matches [] or null', async () => {
      const { service, prisma } = createService({ languages: [] })

      await service.setProjectLanguages(PROJECT_ID, USER_ID, ['de'], [])

      expect(prisma.$runCommandRaw).toHaveBeenCalledWith({
        update: 'projects',
        updates: [
          {
            q: { _id: { $oid: PROJECT_ID }, languages: { $exists: false } },
            u: { $set: { languages: [] } },
          },
        ],
      })
      expect(prisma.project.updateMany).toHaveBeenCalledWith({
        where: { id: PROJECT_ID, ...EMPTY_WHERE },
        data: { languages: { set: ['de'] } },
      })
      // The back-fill runs before the conditional write.
      expect(prisma.$runCommandRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.project.updateMany.mock.invocationCallOrder[0]
      )
    })

    it('brand: an empty expected list back-fills a missing field and matches [] or null', async () => {
      const { service, prisma } = createService({}, { languages: [] })

      await service.setBrandLanguages(BRAND_ID, USER_ID, ['de'], [])

      expect(prisma.$runCommandRaw).toHaveBeenCalledWith({
        update: 'brands',
        updates: [
          {
            q: { _id: { $oid: BRAND_ID }, languages: { $exists: false } },
            u: { $set: { languages: [] } },
          },
        ],
      })
      expect(prisma.brand.updateMany).toHaveBeenCalledWith({
        where: { id: BRAND_ID, ...EMPTY_WHERE },
        data: { languages: { set: ['de'] } },
      })
    })

    it('a non-empty expected list needs no back-fill', async () => {
      const { service, prisma } = createService({ languages: ['de'] })

      await service.setProjectLanguages(
        PROJECT_ID,
        USER_ID,
        ['de', 'en'],
        ['de']
      )

      expect(prisma.$runCommandRaw).not.toHaveBeenCalled()
    })

    it('expected null is treated as absent (the DTO rejects it before)', async () => {
      const { service, prisma } = createService({ languages: ['de', 'en'] })

      await expect(
        service.setProjectLanguages(
          PROJECT_ID,
          USER_ID,
          ['de'],
          null as unknown as string[]
        )
      ).resolves.toEqual({ languages: ['de'], removedValues: 7 })
      expect(prisma.project.updateMany).not.toHaveBeenCalled()
      expect(prisma.project.update).toHaveBeenCalled()
    })

    it.each(['project', 'brand'] as const)(
      '%s: a P2034 write conflict in the transaction becomes the stale-list 409',
      async (kind) => {
        const { service, prisma, changes, auditLogs } = createService(
          { languages: ['de', 'en'] },
          { languages: ['de', 'en'] }
        )
        prisma.$transaction.mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Write conflict', {
            code: 'P2034',
            clientVersion: 'test',
          })
        )

        const call =
          kind === 'project'
            ? service.setProjectLanguages(
                PROJECT_ID,
                USER_ID,
                ['de'],
                ['de', 'en']
              )
            : service.setBrandLanguages(BRAND_ID, USER_ID, ['de'], ['de', 'en'])

        await expect(call).rejects.toThrow(new ConflictException(STALE))
        expect(changes.recordChange).not.toHaveBeenCalled()
        expect(auditLogs.create).not.toHaveBeenCalled()
      }
    )

    it('other errors of the transaction are passed on unchanged', async () => {
      const { service, prisma, changes } = createService({
        languages: ['de', 'en'],
      })
      prisma.$transaction.mockRejectedValueOnce(new Error('boom'))

      await expect(
        service.setProjectLanguages(PROJECT_ID, USER_ID, ['de'], ['de', 'en'])
      ).rejects.toThrow('boom')
      expect(changes.recordChange).not.toHaveBeenCalled()
    })
  })
})
