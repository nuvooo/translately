import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common'
import { MAX_IMPORT_KEYS } from './limits'
import { applyRawValueUpdate } from './testing/fake-raw-value-update'
import { TranslationFilesService } from './translation-files.service'
import { TranslationImportService } from './translation-import.service'

const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const SINGLE_ID = 'b2b2b2b2b2b2b2b2b2b2b2b2'
const ORG_ID = 'cccccccccccccccccccccccc'
const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const BRAND_ID = 'eeeeeeeeeeeeeeeeeeeeeeee'

/** The nested sample of the tree spec: three levels, plurals, interpolation. */
const sample = {
  common: {
    save: 'Speichern',
    nav: { menu: { open: 'Menü öffnen', close: 'Menü schließen' } },
  },
  cart: {
    item_one: '{{count}} Artikel',
    item_other: '{{count}} Artikel',
  },
  title: 'Willkommen',
}

interface KeyRow {
  id: string
  projectId: string
  organizationId: string
  namespace: string
  key: string
  description: string | null
  createdById: string
}
interface ValueRow {
  id: string
  keyId: string
  projectId: string
  language: string
  scope: string
  value: string
  updatedById: string | null
}

const WRITE_METHODS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
  })
}

function matches(row: Record<string, unknown>, where: Record<string, any>) {
  return Object.entries(where).every(([field, condition]) => {
    if (condition && typeof condition === 'object' && 'in' in condition) {
      return condition.in.includes(row[field])
    }
    return row[field] === condition
  })
}

/** In-memory fake of the Prisma models the import touches; counts every write call. */
function createDb() {
  let sequence = 0
  const nextId = () => (++sequence).toString(16).padStart(24, '0')
  const keys: KeyRow[] = []
  const values: ValueRow[] = []
  const writes: string[] = []
  const projects: Record<string, any> = {
    [PROJECT_ID]: {
      id: PROJECT_ID,
      organizationId: ORG_ID,
      type: 'MULTI',
      languages: ['de', 'en'],
      namespaces: ['translation', 'admin'],
    },
    [SINGLE_ID]: {
      id: SINGLE_ID,
      organizationId: ORG_ID,
      type: 'SINGLE',
      languages: ['de'],
      namespaces: ['translation'],
    },
  }
  const brands = [
    { id: BRAND_ID, projectId: PROJECT_ID, languages: ['de', 'fr'] },
  ]
  const failNext: Record<string, number> = {}

  const model = (name: string, rows: any[], extra: Record<string, any>) => {
    const target: Record<string, any> = { ...extra }
    for (const method of WRITE_METHODS) {
      if (target[method]) continue
      target[method] = jest.fn(async () => {
        writes.push(`${name}.${method}`)
        throw new Error(`${name}.${method} is not supported by the fake`)
      })
    }
    target.rows = rows
    return target
  }

  const prisma: any = {
    project: {
      findUnique: jest.fn(async ({ where }: any) => projects[where.id] ?? null),
    },
    brand: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          brands.find(
            (b) => b.id === where.id && b.projectId === where.projectId
          ) ?? null
      ),
    },
    translationKey: model('translationKey', keys, {
      findMany: jest.fn(async ({ where }: any) =>
        keys.filter((k) => matches(k as any, where)).map((k) => ({ ...k }))
      ),
      createMany: jest.fn(async ({ data }: any) => {
        writes.push('translationKey.createMany')
        if (failNext.keys) {
          failNext.keys--
          throw uniqueViolation()
        }
        for (const d of data) {
          if (
            keys.some(
              (k) =>
                k.projectId === d.projectId &&
                k.namespace === d.namespace &&
                k.key === d.key
            )
          ) {
            throw uniqueViolation()
          }
          keys.push({ id: nextId(), description: null, ...d })
        }
        return { count: data.length }
      }),
    }),
    translationValue: model('translationValue', values, {
      findMany: jest.fn(async ({ where }: any) =>
        values.filter((v) => matches(v as any, where)).map((v) => ({ ...v }))
      ),
      createMany: jest.fn(async ({ data }: any) => {
        writes.push('translationValue.createMany')
        for (const d of data) {
          if (
            values.some(
              (v) =>
                v.keyId === d.keyId &&
                v.language === d.language &&
                v.scope === d.scope
            )
          ) {
            throw uniqueViolation()
          }
          values.push({ id: nextId(), updatedById: null, ...d })
        }
        return { count: data.length }
      }),
    }),
    $runCommandRaw: jest.fn(async (command: any) => {
      writes.push('$runCommandRaw')
      // Strict: rejects ObjectIds and dates that are not { $oid } / { $date }.
      return applyRawValueUpdate(values, command)
    }),
    $transaction: jest.fn(async () => {
      writes.push('$transaction')
      throw new Error('$transaction is not supported by the fake')
    }),
    $executeRaw: jest.fn(async () => {
      writes.push('$executeRaw')
    }),
  }

  const addKey = (key: string, namespace = 'translation') => {
    const row: KeyRow = {
      id: nextId(),
      projectId: PROJECT_ID,
      organizationId: ORG_ID,
      namespace,
      key,
      description: null,
      createdById: USER_ID,
    }
    keys.push(row)
    return row
  }
  const addValue = (
    keyId: string,
    language: string,
    value: string,
    scope = 'default'
  ) => {
    values.push({
      id: nextId(),
      keyId,
      projectId: PROJECT_ID,
      language,
      scope,
      value,
      updatedById: null,
    })
  }

  return { prisma, keys, values, writes, addKey, addValue, failNext }
}

function setup() {
  const db = createDb()
  const changes = { recordChange: jest.fn().mockResolvedValue(undefined) }
  const auditLogs = { create: jest.fn().mockResolvedValue({}) }
  const files = new TranslationFilesService(db.prisma)
  const service = new TranslationImportService(
    db.prisma,
    files,
    changes as any,
    auditLogs as any
  )
  return { service, db, changes, auditLogs }
}

const target = { language: 'de' }
const brandTarget = { language: 'de', brandId: BRAND_ID }

function textOf(
  db: ReturnType<typeof createDb>,
  key: string,
  scope = 'default',
  language = 'de'
) {
  const keyRow = db.keys.find((k) => k.key === key)
  return db.values.find(
    (v) =>
      v.keyId === keyRow?.id && v.scope === scope && v.language === language
  )?.value
}

describe('TranslationImportService', () => {
  describe('preview', () => {
    it('reports one new, one changed and one unchanged entry without writing', async () => {
      const { service, db } = setup()
      db.addValue(db.addKey('same').id, 'de', 'Gleich')
      db.addValue(db.addKey('edit').id, 'de', 'Alt')

      const result = await service.preview(PROJECT_ID, target, {
        same: 'Gleich',
        edit: 'Neu',
        fresh: 'Frisch',
      })

      expect(result).toEqual({
        added: ['fresh'],
        changed: ['edit'],
        unchanged: ['same'],
        newKeys: ['fresh'],
        skipped: [],
      })
      expect(db.writes).toEqual([])
    })

    it('counts an existing key without text of this view as added, not as new key', async () => {
      const { service, db } = setup()
      db.addValue(db.addKey('a').id, 'en', 'English only')

      const result = await service.preview(PROJECT_ID, target, { a: 'Text' })

      expect(result.added).toEqual(['a'])
      expect(result.newKeys).toEqual([])
    })

    it('ignores texts of other languages and namespaces', async () => {
      const { service, db } = setup()
      const a = db.addKey('a')
      db.addValue(a.id, 'en', 'Text')
      db.addValue(db.addKey('b', 'admin').id, 'de', 'Text')

      const result = await service.preview(PROJECT_ID, target, {
        a: 'Text',
        b: 'Text',
      })

      expect(result.added).toEqual(['a', 'b'])
      expect(result.newKeys).toEqual(['b'])
    })

    it('passes the skipped entries of flattenTree through', async () => {
      const { service } = setup()

      const result = await service.preview(PROJECT_ID, target, {
        n: 1,
        e: '',
        ok: 'v',
      })

      expect(result.skipped).toEqual([
        { key: 'n', reason: 'not_string' },
        { key: 'e', reason: 'empty' },
      ])
      expect(result.added).toEqual(['ok'])
    })

    it('skips entries that collide with existing keys as conflict, after the flatten skips', async () => {
      const { service, db } = setup()
      db.addValue(db.addKey('nav').id, 'de', 'Navigation')
      db.addKey('menu.open')

      const result = await service.preview(PROJECT_ID, target, {
        x: 1,
        nav: { open: 'Öffnen' },
        menu: 'Menü',
        ok: 'v',
      })

      expect(result).toEqual({
        added: ['ok'],
        changed: [],
        unchanged: [],
        newKeys: ['ok'],
        skipped: [
          { key: 'x', reason: 'not_string' },
          { key: 'menu', reason: 'conflict' },
          { key: 'nav.open', reason: 'conflict' },
        ],
      })
    })

    it('sorts all lists', async () => {
      const { service } = setup()
      const result = await service.preview(PROJECT_ID, target, {
        c: 'x',
        a: 'x',
        b: 'x',
      })
      expect(result.added).toEqual(['a', 'b', 'c'])
      expect(result.newKeys).toEqual(['a', 'b', 'c'])
    })

    it('rejects more than MAX_IMPORT_KEYS entries before touching the database', async () => {
      const { service, db } = setup()
      const content: Record<string, string> = {}
      for (let i = 0; i <= MAX_IMPORT_KEYS; i++) content[`k${i}`] = 'x'
      expect(Object.keys(content)).toHaveLength(20_001)

      await expect(
        service.preview(PROJECT_ID, target, content)
      ).rejects.toBeInstanceOf(PayloadTooLargeException)
      await expect(
        service.apply(PROJECT_ID, USER_ID, target, content)
      ).rejects.toBeInstanceOf(PayloadTooLargeException)
      expect(db.prisma.project.findUnique).not.toHaveBeenCalled()
      expect(db.writes).toEqual([])
    })

    it('counts skipped entries towards the limit', async () => {
      const { service } = setup()
      const content: Record<string, number> = {}
      for (let i = 0; i < 30_000; i++) content[`k${i}`] = i
      await expect(
        service.preview(PROJECT_ID, target, content)
      ).rejects.toBeInstanceOf(PayloadTooLargeException)
    })

    it('accepts exactly MAX_IMPORT_KEYS entries', async () => {
      const { service } = setup()
      const content: Record<string, string> = {}
      for (let i = 0; i < MAX_IMPORT_KEYS; i++) content[`k${i}`] = 'x'
      const result = await service.preview(PROJECT_ID, target, content)
      expect(result.added).toHaveLength(MAX_IMPORT_KEYS)
    })

    it('rejects content that is not a JSON object', async () => {
      const { service } = setup()
      for (const content of [null, [], 'x', 1]) {
        await expect(
          service.preview(PROJECT_ID, target, content)
        ).rejects.toBeInstanceOf(BadRequestException)
      }
    })

    it('rejects an unknown namespace and a language outside the view', async () => {
      const { service } = setup()
      await expect(
        service.preview(
          PROJECT_ID,
          { ...target, namespace: 'unknown' },
          { a: 'x' }
        )
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.preview(PROJECT_ID, { ...target, language: 'fr' }, { a: 'x' })
      ).rejects.toBeInstanceOf(BadRequestException)
      // Case-sensitive: 'DE' is not 'de'.
      await expect(
        service.preview(PROJECT_ID, { ...target, language: 'DE' }, { a: 'x' })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.preview(
          PROJECT_ID,
          { ...brandTarget, language: 'en' },
          { a: 'x' }
        )
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects a brand on a SINGLE project and an unknown project', async () => {
      const { service } = setup()
      await expect(
        service.preview(SINGLE_ID, { ...target, brandId: BRAND_ID }, { a: 'x' })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.preview('ffffffffffffffffffffffff', target, { a: 'x' })
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('uses the given namespace', async () => {
      const { service, db } = setup()
      db.addValue(db.addKey('a', 'admin').id, 'de', 'x')
      const result = await service.preview(
        PROJECT_ID,
        { ...target, namespace: 'admin' },
        { a: 'x' }
      )
      expect(result.unchanged).toEqual(['a'])
    })
  })

  describe('brand view', () => {
    it('treats a text equal to the inherited standard text as unchanged and writes nothing', async () => {
      const { service, db, changes, auditLogs } = setup()
      db.addValue(db.addKey('greeting').id, 'de', 'Hallo')

      const content = { greeting: 'Hallo' }
      const expected = {
        added: [],
        changed: [],
        unchanged: ['greeting'],
        newKeys: [],
        skipped: [],
      }
      expect(await service.preview(PROJECT_ID, brandTarget, content)).toEqual(
        expected
      )
      expect(
        await service.apply(PROJECT_ID, USER_ID, brandTarget, content)
      ).toEqual(expected)

      expect(db.writes).toEqual([])
      expect(db.values).toHaveLength(1)
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('compares with the brand override, not with the inherited text', async () => {
      const { service, db } = setup()
      const a = db.addKey('a')
      db.addValue(a.id, 'de', 'Standard')
      db.addValue(a.id, 'de', 'Marke', BRAND_ID)
      const b = db.addKey('b')
      db.addValue(b.id, 'de', 'Standard')
      const c = db.addKey('c')
      db.addValue(c.id, 'de', 'Standard')
      db.addValue(c.id, 'de', 'Eigen', BRAND_ID)

      const result = await service.preview(PROJECT_ID, brandTarget, {
        a: 'Standard',
        b: 'Anders',
        c: 'Eigen',
        d: 'Neu',
      })

      expect(result).toEqual({
        added: ['b', 'd'],
        changed: ['a'],
        unchanged: ['c'],
        newKeys: ['d'],
        skipped: [],
      })
    })

    it('has nothing to inherit for a brand-only language', async () => {
      const { service, db } = setup()
      const a = db.addKey('a')
      db.addValue(a.id, 'fr', 'Bonjour')

      const result = await service.preview(
        PROJECT_ID,
        { ...brandTarget, language: 'fr' },
        { a: 'Bonjour' }
      )

      expect(result.added).toEqual(['a'])
    })

    it('writes the brand texts with the brand as scope', async () => {
      const { service, db } = setup()
      db.addValue(db.addKey('a').id, 'de', 'Standard')

      await service.apply(PROJECT_ID, USER_ID, brandTarget, {
        a: 'Marke',
        n: 'Neu',
      })

      expect(textOf(db, 'a')).toBe('Standard')
      expect(textOf(db, 'a', BRAND_ID)).toBe('Marke')
      expect(textOf(db, 'n', BRAND_ID)).toBe('Neu')
      expect(textOf(db, 'n')).toBeUndefined()
    })
  })

  describe('apply', () => {
    it('creates new keys and values, updates changed values and returns the preview', async () => {
      const { service, db } = setup()
      db.addValue(db.addKey('same').id, 'de', 'Gleich')
      db.addValue(db.addKey('edit').id, 'de', 'Alt')
      const content = { same: 'Gleich', edit: 'Neu', fresh: 'Frisch' }
      const expected = await service.preview(PROJECT_ID, target, content)

      const result = await service.apply(PROJECT_ID, USER_ID, target, content)

      expect(result).toEqual(expected)
      expect(textOf(db, 'same')).toBe('Gleich')
      expect(textOf(db, 'edit')).toBe('Neu')
      expect(textOf(db, 'fresh')).toBe('Frisch')
      const fresh = db.keys.find((k) => k.key === 'fresh')
      expect(fresh).toMatchObject({
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        namespace: 'translation',
        createdById: USER_ID,
      })
      expect(db.values.find((v) => v.keyId === fresh?.id)?.updatedById).toBe(
        USER_ID
      )
      expect(
        db.values.find(
          (v) => v.keyId === db.keys.find((k) => k.key === 'edit')?.id
        )?.updatedById
      ).toBe(USER_ID)
    })

    it('never deletes anything', async () => {
      const { service, db } = setup()
      db.addValue(db.addKey('keep').id, 'de', 'Bleibt')
      db.addValue(db.addKey('edit').id, 'de', 'Alt')

      await service.apply(PROJECT_ID, USER_ID, target, {
        edit: 'Neu',
        e: '',
        fresh: 'x',
      })

      expect(db.prisma.translationValue.deleteMany).not.toHaveBeenCalled()
      expect(db.prisma.translationKey.deleteMany).not.toHaveBeenCalled()
      expect(db.prisma.translationValue.delete).not.toHaveBeenCalled()
      expect(db.prisma.translationKey.delete).not.toHaveBeenCalled()
      expect(textOf(db, 'keep')).toBe('Bleibt')
      expect(db.writes.some((w) => w.includes('delete'))).toBe(false)
    })

    it('records exactly one change event and one audit entry', async () => {
      const { service, db, changes, auditLogs } = setup()
      db.addValue(db.addKey('edit').id, 'de', 'Alt')

      await service.apply(PROJECT_ID, USER_ID, target, {
        edit: 'Neu',
        a: 'x',
        b: 'y',
        bad: 1,
      })

      expect(changes.recordChange).toHaveBeenCalledTimes(1)
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [
          { namespace: 'translation', language: 'de', action: 'imported' },
        ],
      })
      expect(auditLogs.create).toHaveBeenCalledTimes(1)
      expect(auditLogs.create).toHaveBeenCalledWith({
        action: 'translation.imported',
        entityType: 'Project',
        entityId: PROJECT_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        newValues: {
          language: 'de',
          namespace: 'translation',
          scope: 'default',
          added: 2,
          changed: 1,
          skipped: 1,
        },
      })
    })

    it('audits the brand as scope', async () => {
      const { service, auditLogs } = setup()
      await service.apply(PROJECT_ID, USER_ID, brandTarget, { a: 'x' })
      expect(auditLogs.create.mock.calls[0][0].newValues.scope).toBe(BRAND_ID)
    })

    it('records nothing when nothing changes', async () => {
      const { service, db, changes, auditLogs } = setup()
      db.addValue(db.addKey('same').id, 'de', 'Gleich')

      await service.apply(PROJECT_ID, USER_ID, target, {
        same: 'Gleich',
        bad: 1,
      })

      expect(db.writes).toEqual([])
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('uses at most 10 Prisma write calls for 5,000 entries', async () => {
      const { service, db } = setup()
      const content: Record<string, string> = {}
      for (let i = 0; i < 5_000; i++) {
        const key = `group${i % 10}.key${i}`
        if (i % 2 === 0) db.addValue(db.addKey(key).id, 'de', 'Alt')
        content[key] = `Neu ${i}`
      }
      db.writes.length = 0

      const result = await service.apply(PROJECT_ID, USER_ID, target, content)

      expect(result.added).toHaveLength(2_500)
      expect(result.changed).toHaveLength(2_500)
      expect(result.newKeys).toHaveLength(2_500)
      expect(db.writes.length).toBeLessThanOrEqual(10)
      expect(textOf(db, 'group0.key0')).toBe('Neu 0')
      expect(textOf(db, 'group1.key1')).toBe('Neu 1')
    })

    it('retries once after a unique violation from a concurrent writer', async () => {
      const { service, db } = setup()
      db.failNext.keys = 1

      const result = await service.apply(PROJECT_ID, USER_ID, target, {
        a: 'x',
      })

      expect(result.added).toEqual(['a'])
      expect(textOf(db, 'a')).toBe('x')
      expect(db.prisma.translationKey.createMany).toHaveBeenCalledTimes(2)
    })

    it('reports a repeated unique violation as conflict, not as server error', async () => {
      const { service, db } = setup()
      db.failNext.keys = 2

      await expect(
        service.apply(PROJECT_ID, USER_ID, target, { a: 'x' })
      ).rejects.toBeInstanceOf(ConflictException)
    })

    // Texts already written must reach clients even when the request fails:
    // without a version bump they would keep getting 304.
    it('records the change once when the write fails after texts were written, then rethrows', async () => {
      const { service, db, changes, auditLogs } = setup()
      db.addValue(db.addKey('edit').id, 'de', 'Alt')
      const lost = new Error('connection lost')
      db.prisma.$runCommandRaw.mockRejectedValueOnce(lost)

      await expect(
        service.apply(PROJECT_ID, USER_ID, target, { edit: 'Neu', fresh: 'x' })
      ).rejects.toBe(lost)

      expect(textOf(db, 'fresh')).toBe('x')
      expect(changes.recordChange).toHaveBeenCalledTimes(1)
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [
          { namespace: 'translation', language: 'de', action: 'imported' },
        ],
      })
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('records nothing when the import fails before any text write', async () => {
      const { service, db, changes, auditLogs } = setup()
      const down = new Error('db down')
      db.prisma.translationKey.createMany.mockRejectedValueOnce(down)

      await expect(
        service.apply(PROJECT_ID, USER_ID, target, { fresh: 'x' })
      ).rejects.toBe(down)

      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('records the change when a write partly landed before a retry found nothing left to do', async () => {
      const { service, db, changes, auditLogs } = setup()
      db.prisma.translationValue.createMany.mockImplementationOnce(
        async ({ data }: any) => {
          for (const d of data)
            db.values.push({
              id: `partial-${d.keyId}`,
              updatedById: null,
              ...d,
            })
          throw uniqueViolation()
        }
      )

      const result = await service.apply(PROJECT_ID, USER_ID, target, {
        fresh: 'x',
      })

      expect(result.added).toEqual([])
      expect(result.unchanged).toEqual(['fresh'])
      expect(changes.recordChange).toHaveBeenCalledTimes(1)
      expect(auditLogs.create).not.toHaveBeenCalled()
    })
  })

  describe('exportFile', () => {
    it('returns the imported object after an import (round trip)', async () => {
      const { service } = setup()

      await service.apply(PROJECT_ID, USER_ID, target, sample)
      const result = await service.exportFile(PROJECT_ID, target)

      expect(result).toEqual({
        namespace: 'translation',
        language: 'de',
        tree: sample,
      })
    })

    it('exports own plus inherited texts of a brand view', async () => {
      const { service, db } = setup()
      const a = db.addKey('a')
      db.addValue(a.id, 'de', 'Standard A')
      const b = db.addKey('b')
      db.addValue(b.id, 'de', 'Standard B')
      db.addValue(b.id, 'de', 'Marke B', BRAND_ID)

      const result = await service.exportFile(PROJECT_ID, brandTarget)

      expect(result.tree).toEqual({ a: 'Standard A', b: 'Marke B' })
    })

    it('rejects a language the view does not offer and an unknown namespace', async () => {
      const { service } = setup()
      await expect(
        service.exportFile(PROJECT_ID, { ...target, language: 'fr' })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.exportFile(PROJECT_ID, { ...brandTarget, language: 'en' })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.exportFile(PROJECT_ID, { ...target, namespace: 'nope' })
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })
})
