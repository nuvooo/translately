import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { TranslationsService } from './translations.service'

const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const ORG_ID = 'cccccccccccccccccccccccc'
const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const BRAND_ID = 'eeeeeeeeeeeeeeeeeeeeeeee'
const KEY_ID = '111111111111111111111111'

const project = {
  id: PROJECT_ID,
  organizationId: ORG_ID,
  type: 'MULTI',
  languages: ['de', 'en'],
  namespaces: ['translation', 'admin'],
}

const keyRow = {
  id: KEY_ID,
  projectId: PROJECT_ID,
  organizationId: ORG_ID,
  namespace: 'translation',
  key: 'home.title',
  description: null,
}

function createService() {
  const prisma: any = {
    project: { findUnique: jest.fn().mockResolvedValue(project) },
    brand: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: BRAND_ID, languages: ['de', 'fr'] }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    translationKey: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(keyRow),
      create: jest.fn().mockImplementation(({ data }: any) => ({
        id: KEY_ID,
        description: null,
        ...data,
      })),
      update: jest.fn().mockImplementation(({ data }: any) => ({
        ...keyRow,
        ...data,
      })),
      delete: jest.fn().mockResolvedValue(keyRow),
    },
    translationValue: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn().mockImplementation((ops: any) => Promise.all(ops)),
  }
  const changes = { recordChange: jest.fn().mockResolvedValue(undefined) }
  const auditLogs = { create: jest.fn().mockResolvedValue({}) }
  const service = new TranslationsService(
    prisma,
    changes as any,
    auditLogs as any
  )
  return { service, prisma, changes, auditLogs }
}

function keys(...names: string[]) {
  return names.map((key, i) => ({
    id: `k${i}`,
    key,
    description: null,
  }))
}

function value(
  keyId: string,
  language: string,
  text: string,
  scope = 'default'
) {
  return { keyId, language, scope, value: text }
}

describe('TranslationsService', () => {
  describe('getTable', () => {
    const BRAND_B = 'ffffffffffffffffffffffff'

    it('default texts: text cell, missing cell, never inherited, no overrides', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue(keys('a'))
      prisma.translationValue.findMany.mockResolvedValue([
        value('k0', 'de', 'Hallo'),
      ])

      const table = await service.getTable(PROJECT_ID, {})

      expect(table.languages).toEqual(['de', 'en'])
      expect(table.namespaces).toEqual(['translation', 'admin'])
      expect(table.rows).toEqual([
        {
          keyId: 'k0',
          key: 'a',
          description: null,
          locked: false,
          values: {
            de: { value: 'Hallo', inherited: false },
            en: { value: null, inherited: false },
          },
          overrides: {},
        },
      ])
      expect(table.total).toBe(1)
      expect(table.page).toBe(1)
      expect(table.pageSize).toBe(50)
    })

    it('runs two data queries plus one brand query, scoped to namespace and scopes', async () => {
      const { service, prisma } = createService()
      prisma.brand.findMany.mockResolvedValue([
        { id: BRAND_ID, name: 'A', languages: ['de', 'fr'] },
        { id: BRAND_B, name: 'B', languages: ['de'] },
      ])
      prisma.translationKey.findMany.mockResolvedValue(keys('a', 'b', 'c'))

      await service.getTable(PROJECT_ID, { namespace: 'admin' })

      expect(prisma.translationKey.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.translationKey.findMany.mock.calls[0][0].where).toEqual({
        projectId: PROJECT_ID,
        namespace: 'admin',
      })
      expect(prisma.brand.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.brand.findMany.mock.calls[0][0].where).toEqual({
        projectId: PROJECT_ID,
      })
      expect(prisma.translationValue.findMany).toHaveBeenCalledTimes(1)
      const where = prisma.translationValue.findMany.mock.calls[0][0].where
      expect(where.keyId).toEqual({ in: ['k0', 'k1', 'k2'] })
      expect(where.scope).toEqual({ in: ['default', BRAND_ID, BRAND_B] })
    })

    it('MULTI: adds brand-only languages and returns the overrides of all brands', async () => {
      const { service, prisma } = createService()
      prisma.brand.findMany.mockResolvedValue([
        { id: BRAND_ID, name: 'A', languages: ['de', 'fr'] },
        { id: BRAND_B, name: 'B', languages: ['de'] },
      ])
      prisma.translationKey.findMany.mockResolvedValue(keys('a'))
      prisma.translationValue.findMany.mockResolvedValue([
        value('k0', 'de', 'Standard'),
        value('k0', 'de', 'A-Text', BRAND_ID),
      ])

      const table = await service.getTable(PROJECT_ID, {})

      expect(table.languages).toEqual(['de', 'en', 'fr'])
      expect(table.rows[0].overrides).toEqual({ [BRAND_ID]: { de: 'A-Text' } })
      expect(table.rows[0].values).toEqual({
        de: { value: 'Standard', inherited: false },
        en: { value: null, inherited: false },
        fr: { value: null, inherited: false },
      })
    })

    it('SINGLE: only project languages and empty overrides, brands are not loaded', async () => {
      const { service, prisma } = createService()
      prisma.project.findUnique.mockResolvedValue({
        ...project,
        type: 'SINGLE',
      })
      prisma.translationKey.findMany.mockResolvedValue(keys('a'))

      const table = await service.getTable(PROJECT_ID, {})

      expect(table.languages).toEqual(['de', 'en'])
      expect(table.rows[0].overrides).toEqual({})
      expect(prisma.brand.findMany).not.toHaveBeenCalled()
    })

    it('an override in a language no longer in the brand list is left out', async () => {
      const { service, prisma } = createService()
      prisma.brand.findMany.mockResolvedValue([
        { id: BRAND_ID, name: 'A', languages: ['de'] },
      ])
      prisma.translationKey.findMany.mockResolvedValue(keys('a'))
      prisma.translationValue.findMany.mockResolvedValue([
        value('k0', 'de', 'A-Text', BRAND_ID),
        value('k0', 'fr', 'Stale', BRAND_ID),
      ])

      const table = await service.getTable(PROJECT_ID, {})

      expect(table.rows[0].overrides).toEqual({ [BRAND_ID]: { de: 'A-Text' } })
      expect(table.languages).toEqual(['de', 'en'])
    })

    it('missingOnly keeps rows that lack a default text in a project language', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue(keys('a', 'b'))
      prisma.translationValue.findMany.mockResolvedValue([
        value('k0', 'de', 'x'),
        value('k0', 'en', 'y'),
        value('k1', 'de', 'z'),
      ])

      const table = await service.getTable(PROJECT_ID, { missingOnly: true })

      expect(table.rows.map((r) => r.key)).toEqual(['b'])
      expect(table.total).toBe(1)
    })

    it('missingOnly ignores a missing text in a brand-only language', async () => {
      const { service, prisma } = createService()
      prisma.brand.findMany.mockResolvedValue([
        { id: BRAND_ID, name: 'A', languages: ['de', 'fr'] },
      ])
      prisma.translationKey.findMany.mockResolvedValue(keys('a'))
      prisma.translationValue.findMany.mockResolvedValue([
        value('k0', 'de', 'x'),
        value('k0', 'en', 'y'),
      ])

      const table = await service.getTable(PROJECT_ID, { missingOnly: true })

      expect(table.rows).toEqual([])
      expect(table.total).toBe(0)
    })

    it('search matches the key case-insensitively', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue(
        keys('home.Title', 'footer')
      )

      const table = await service.getTable(PROJECT_ID, { search: 'TITLE' })

      expect(table.rows.map((r) => r.key)).toEqual(['home.Title'])
    })

    it('search matches the default texts', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue(keys('a', 'b'))
      prisma.translationValue.findMany.mockResolvedValue([
        value('k1', 'en', 'Welcome Home'),
      ])

      const table = await service.getTable(PROJECT_ID, { search: 'welcome' })

      expect(table.rows.map((r) => r.key)).toEqual(['b'])
    })

    it('search finds a row whose only hit is in an override', async () => {
      const { service, prisma } = createService()
      prisma.brand.findMany.mockResolvedValue([
        { id: BRAND_ID, name: 'A', languages: ['de', 'fr'] },
      ])
      prisma.translationKey.findMany.mockResolvedValue(keys('a', 'b'))
      prisma.translationValue.findMany.mockResolvedValue([
        value('k1', 'de', 'Sonderangebot', BRAND_ID),
      ])

      const table = await service.getTable(PROJECT_ID, { search: 'sonder' })

      expect(table.rows.map((r) => r.key)).toEqual(['b'])
    })

    it('search without a hit returns no rows', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue(keys('a'))
      prisma.translationValue.findMany.mockResolvedValue([
        value('k0', 'en', 'Hello'),
      ])

      const table = await service.getTable(PROJECT_ID, { search: '.*' })

      expect(table.rows).toEqual([])
      expect(table.total).toBe(0)
    })

    it('clamps pageSize 1000 to 200 and pages after filtering', async () => {
      const { service, prisma } = createService()
      const names = Array.from(
        { length: 250 },
        (_, i) => `k${String(i).padStart(3, '0')}`
      )
      prisma.translationKey.findMany.mockResolvedValue(keys(...names))

      const table = await service.getTable(PROJECT_ID, {
        pageSize: 1000,
        page: 2,
      })

      expect(table.pageSize).toBe(200)
      expect(table.page).toBe(2)
      expect(table.total).toBe(250)
      expect(table.rows).toHaveLength(50)
      expect(table.rows[0].key).toBe('k200')
    })

    it('sorts rows by key', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue(keys('b', 'a'))

      const table = await service.getTable(PROJECT_ID, {})

      expect(table.rows.map((r) => r.key)).toEqual(['a', 'b'])
    })

    it('rejects a namespace that is not in the project', async () => {
      const { service } = createService()
      await expect(
        service.getTable(PROJECT_ID, { namespace: 'other' })
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('createKey', () => {
    it('creates the key, records a change and audits', async () => {
      const { service, prisma, changes, auditLogs } = createService()

      const result = await service.createKey(PROJECT_ID, USER_ID, {
        key: 'home.title',
      })

      expect(result).toEqual({
        id: KEY_ID,
        namespace: 'translation',
        key: 'home.title',
      })
      expect(prisma.translationKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: PROJECT_ID,
          organizationId: ORG_ID,
          namespace: 'translation',
          key: 'home.title',
          createdById: USER_ID,
        }),
      })
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [
          { key: 'home.title', namespace: 'translation', action: 'created' },
        ],
      })
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'translation.key_created',
          entityType: 'TranslationKey',
          entityId: KEY_ID,
        })
      )
    })

    it('rejects a duplicate with ConflictException', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue([{ key: 'home.title' }])
      await expect(
        service.createKey(PROJECT_ID, USER_ID, { key: 'home.title' })
      ).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.translationKey.create).not.toHaveBeenCalled()
    })

    it("rejects 'a.b' when 'a' exists and names 'a'", async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue([{ key: 'a' }])
      const error = await service
        .createKey(PROJECT_ID, USER_ID, { key: 'a.b' })
        .catch((e) => e)
      expect(error).toBeInstanceOf(ConflictException)
      expect(error.message).toContain('"a"')
    })

    it('maps a unique index race (P2002) to ConflictException', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.create.mockRejectedValue({ code: 'P2002' })
      await expect(
        service.createKey(PROJECT_ID, USER_ID, { key: 'x' })
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('rejects a namespace that is not in the project', async () => {
      const { service } = createService()
      await expect(
        service.createKey(PROJECT_ID, USER_ID, {
          namespace: 'other',
          key: 'x',
        })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects an invalid key', async () => {
      const { service } = createService()
      await expect(
        service.createKey(PROJECT_ID, USER_ID, { key: 'a..b' })
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('updateKey', () => {
    it('renames, records a change and audits', async () => {
      const { service, prisma, changes, auditLogs } = createService()
      prisma.translationKey.findMany.mockResolvedValue([{ key: 'other' }])

      const result = await service.updateKey(KEY_ID, USER_ID, {
        key: 'home.heading',
      })

      expect(result).toEqual({
        id: KEY_ID,
        namespace: 'translation',
        key: 'home.heading',
      })
      expect(prisma.translationKey.findMany.mock.calls[0][0].where).toEqual({
        projectId: PROJECT_ID,
        namespace: 'translation',
        id: { not: KEY_ID },
      })
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [
          { key: 'home.heading', namespace: 'translation', action: 'updated' },
        ],
      })
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'translation.key_updated' })
      )
    })

    it('rejects a rename into a leaf/parent conflict', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue([{ key: 'home' }])
      await expect(
        service.updateKey(KEY_ID, USER_ID, { key: 'home.x' })
      ).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.translationKey.update).not.toHaveBeenCalled()
    })

    it('rejects a rename onto an existing key', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue([{ key: 'taken' }])
      await expect(
        service.updateKey(KEY_ID, USER_ID, { key: 'taken' })
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('skips conflict checks for an unchanged name and clears the description', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findUnique.mockResolvedValue({
        ...keyRow,
        description: 'old',
      })

      await service.updateKey(KEY_ID, USER_ID, {
        key: 'home.title',
        description: null,
      })

      expect(prisma.translationKey.findMany).not.toHaveBeenCalled()
      expect(prisma.translationKey.update).toHaveBeenCalledWith({
        where: { id: KEY_ID },
        data: { description: null },
      })
    })

    it('throws NotFoundException for a missing key', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findUnique.mockResolvedValue(null)
      await expect(
        service.updateKey(KEY_ID, USER_ID, { key: 'x' })
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('locked keys', () => {
    const lockedRow = { ...keyRow, locked: true }

    it('marks a locked key in the table', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findMany.mockResolvedValue([
        { id: 'k0', key: 'a', description: null, locked: true },
        { id: 'k1', key: 'b', description: null },
      ])

      const table = await service.getTable(PROJECT_ID, {})

      expect(table.rows.map((r) => r.locked)).toEqual([true, false])
    })

    it('refuses to rename a locked key with 409', async () => {
      const { service, prisma, changes } = createService()
      prisma.translationKey.findUnique.mockResolvedValue(lockedRow)

      await expect(
        service.updateKey(KEY_ID, USER_ID, { key: 'home.heading' })
      ).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.translationKey.update).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
    })

    it('still changes the description of a locked key', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findUnique.mockResolvedValue(lockedRow)

      await service.updateKey(KEY_ID, USER_ID, { description: 'new' })

      expect(prisma.translationKey.update).toHaveBeenCalledWith({
        where: { id: KEY_ID },
        data: { description: 'new' },
      })
    })

    it('refuses to delete a locked key with 409', async () => {
      const { service, prisma } = createService()
      prisma.translationKey.findUnique.mockResolvedValue(lockedRow)

      await expect(service.deleteKey(KEY_ID, USER_ID)).rejects.toBeInstanceOf(
        ConflictException
      )
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(prisma.translationKey.delete).not.toHaveBeenCalled()
    })

    it('locks a key and audits it', async () => {
      const { service, prisma, auditLogs } = createService()
      prisma.translationKey.update.mockResolvedValue(lockedRow)

      const result = await service.setKeyLocked(KEY_ID, USER_ID, true)

      expect(result).toEqual({
        id: KEY_ID,
        namespace: 'translation',
        key: 'home.title',
        locked: true,
      })
      expect(prisma.translationKey.update).toHaveBeenCalledWith({
        where: { id: KEY_ID },
        data: { locked: true },
      })
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'translation.key_locked' })
      )
    })

    it('unlocks a key and audits it', async () => {
      const { service, prisma, auditLogs } = createService()
      prisma.translationKey.findUnique.mockResolvedValue(lockedRow)
      prisma.translationKey.update.mockResolvedValue({
        ...keyRow,
        locked: false,
      })

      const result = await service.setKeyLocked(KEY_ID, USER_ID, false)

      expect(result.locked).toBe(false)
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'translation.key_unlocked' })
      )
    })

    it('writes nothing when the key already has the wanted state', async () => {
      const { service, prisma, auditLogs } = createService()

      const result = await service.setKeyLocked(KEY_ID, USER_ID, false)

      expect(result.locked).toBe(false)
      expect(prisma.translationKey.update).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })
  })

  describe('deleteKey', () => {
    it('deletes values and key, records a change and audits', async () => {
      const { service, prisma, changes, auditLogs } = createService()

      await service.deleteKey(KEY_ID, USER_ID)

      expect(prisma.translationValue.deleteMany).toHaveBeenCalledWith({
        where: { keyId: KEY_ID },
      })
      expect(prisma.translationKey.delete).toHaveBeenCalledWith({
        where: { id: KEY_ID },
      })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [
          { key: 'home.title', namespace: 'translation', action: 'deleted' },
        ],
      })
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'translation.key_deleted' })
      )
    })
  })

  describe('setValue', () => {
    const where = (scope: string, language = 'de') => ({
      keyId_language_scope: {
        keyId: KEY_ID,
        language,
        scope,
      },
    })

    it('upserts the default text and records one change', async () => {
      const { service, prisma, changes, auditLogs } = createService()

      const cell = await service.setValue(KEY_ID, USER_ID, {
        language: 'de',
        value: 'Hallo',
      })

      expect(cell).toEqual({ value: 'Hallo', inherited: false })
      expect(prisma.translationValue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: where('default'),
          update: expect.objectContaining({ value: 'Hallo' }),
          create: expect.objectContaining({
            keyId: KEY_ID,
            projectId: PROJECT_ID,
            language: 'de',
            scope: 'default',
            value: 'Hallo',
          }),
        })
      )
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
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'translation.value_updated',
          entityType: 'TranslationKey',
          entityId: KEY_ID,
          newValues: {
            language: 'de',
            scope: 'default',
            value: 'Hallo',
          },
        })
      )
    })

    it("with '' calls deleteMany and returns the inherited cell for a brand", async () => {
      const { service, prisma, changes, auditLogs } = createService()
      prisma.translationValue.findUnique.mockImplementation(({ where }: any) =>
        where.keyId_language_scope.scope === BRAND_ID
          ? value(KEY_ID, 'de', 'Eigen', BRAND_ID)
          : value(KEY_ID, 'de', 'Standard')
      )

      const cell = await service.setValue(KEY_ID, USER_ID, {
        language: 'de',
        brandId: BRAND_ID,
        value: '',
      })

      expect(prisma.translationValue.deleteMany).toHaveBeenCalledWith({
        where: {
          keyId: KEY_ID,
          language: 'de',
          scope: BRAND_ID,
        },
      })
      expect(prisma.translationValue.upsert).not.toHaveBeenCalled()
      expect(cell).toEqual({ value: 'Standard', inherited: true })
      expect(changes.recordChange).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: [
            {
              key: 'home.title',
              namespace: 'translation',
              language: 'de',
              action: 'deleted',
            },
          ],
        })
      )
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'translation.value_deleted',
          oldValues: {
            language: 'de',
            scope: BRAND_ID,
            value: 'Eigen',
          },
        })
      )
    })

    it("with '' in the default view returns a missing cell", async () => {
      const { service, prisma } = createService()
      prisma.translationValue.findUnique.mockResolvedValue(
        value(KEY_ID, 'de', 'Alt')
      )

      const cell = await service.setValue(KEY_ID, USER_ID, {
        language: 'de',
        value: '',
      })

      expect(prisma.translationValue.deleteMany).toHaveBeenCalled()
      expect(cell).toEqual({ value: null, inherited: false })
    })

    it("with '' on a missing row records nothing", async () => {
      const { service, prisma, changes, auditLogs } = createService()
      prisma.translationValue.deleteMany.mockResolvedValue({ count: 0 })

      const cell = await service.setValue(KEY_ID, USER_ID, {
        language: 'de',
        value: '',
      })

      expect(cell).toEqual({ value: null, inherited: false })
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('writes nothing when the value is unchanged', async () => {
      const { service, prisma, changes, auditLogs } = createService()
      prisma.translationValue.findUnique.mockResolvedValue(
        value(KEY_ID, 'de', 'Hallo')
      )

      const cell = await service.setValue(KEY_ID, USER_ID, {
        language: 'de',
        value: 'Hallo',
      })

      expect(cell).toEqual({ value: 'Hallo', inherited: false })
      expect(prisma.translationValue.upsert).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('writes a brand override into the brand scope', async () => {
      const { service, prisma } = createService()

      const cell = await service.setValue(KEY_ID, USER_ID, {
        language: 'fr',
        brandId: BRAND_ID,
        value: 'Bonjour',
      })

      expect(cell).toEqual({ value: 'Bonjour', inherited: false })
      expect(prisma.translationValue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: where(BRAND_ID, 'fr') })
      )
    })

    it('rejects a language that is not in the view list', async () => {
      const { service } = createService()
      await expect(
        service.setValue(KEY_ID, USER_ID, {
          language: 'fr',
          value: 'x',
        })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.setValue(KEY_ID, USER_ID, {
          language: 'en',
          brandId: BRAND_ID,
          value: 'x',
        })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('compares language codes case-sensitively', async () => {
      const { service } = createService()
      await expect(
        service.setValue(KEY_ID, USER_ID, {
          language: 'DE',
          value: 'x',
        })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects a brand on a SINGLE project', async () => {
      const { service, prisma } = createService()
      prisma.project.findUnique.mockResolvedValue({
        ...project,
        type: 'SINGLE',
      })
      await expect(
        service.setValue(KEY_ID, USER_ID, {
          language: 'de',
          brandId: BRAND_ID,
          value: 'x',
        })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('retries once when the first upsert hits P2002', async () => {
      const { service, prisma } = createService()
      prisma.translationValue.upsert
        .mockRejectedValueOnce({ code: 'P2002' })
        .mockResolvedValueOnce({})

      await expect(
        service.setValue(KEY_ID, USER_ID, {
          language: 'de',
          value: 'Hallo',
        })
      ).resolves.toEqual({ value: 'Hallo', inherited: false })
      expect(prisma.translationValue.upsert).toHaveBeenCalledTimes(2)
    })

    it('lets a second P2002 propagate', async () => {
      const { service, prisma } = createService()
      prisma.translationValue.upsert.mockRejectedValue({ code: 'P2002' })
      await expect(
        service.setValue(KEY_ID, USER_ID, {
          language: 'de',
          value: 'Hallo',
        })
      ).rejects.toEqual({ code: 'P2002' })
      expect(prisma.translationValue.upsert).toHaveBeenCalledTimes(2)
    })
  })
})
