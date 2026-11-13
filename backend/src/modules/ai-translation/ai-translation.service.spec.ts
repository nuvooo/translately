import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common'
import { AiTranslationService } from './ai-translation.service'
import { AiTranslationUnavailableError } from './ai-translator'

const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const ORG_ID = 'cccccccccccccccccccccccc'
const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const BRAND_ID = 'eeeeeeeeeeeeeeeeeeeeeeee'
const K1 = '111111111111111111111111'
const K2 = '222222222222222222222222'
const K3 = '333333333333333333333333'
const K4 = '444444444444444444444444'
const K5 = '555555555555555555555555'
const FOREIGN = '999999999999999999999999'

interface KeyRow {
  id: string
  projectId: string
  organizationId: string
  namespace: string
  key: string
  description: string | null
}
interface ValueRow {
  keyId: string
  projectId: string
  language: string
  scope: string
  value: string
}

const key = (
  id: string,
  name: string,
  extra: Partial<KeyRow> = {}
): KeyRow => ({
  id,
  projectId: PROJECT_ID,
  organizationId: ORG_ID,
  namespace: 'translation',
  key: name,
  description: null,
  ...extra,
})
const val = (
  keyId: string,
  language: string,
  value: string,
  scope = 'default'
): ValueRow => ({ keyId, projectId: PROJECT_ID, language, scope, value })

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([field, cond]) => {
    if (cond && typeof cond === 'object' && 'in' in (cond as any)) {
      return (cond as any).in.includes(row[field])
    }
    return row[field] === cond
  })
}

function createService(
  opts: {
    keys?: KeyRow[]
    values?: ValueRow[]
    type?: string
    languages?: string[]
    brandLanguages?: string[]
    translate?: jest.Mock
    enabled?: boolean
    createError?: (data: any) => unknown
  } = {}
) {
  const keys = opts.keys ?? []
  const values = [...(opts.values ?? [])]
  const prisma: any = {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        id: PROJECT_ID,
        organizationId: ORG_ID,
        type: opts.type ?? 'MULTI',
        languages: opts.languages ?? ['de', 'en', 'fr'],
        namespaces: ['translation'],
      }),
    },
    brand: {
      findFirst: jest.fn().mockResolvedValue({
        id: BRAND_ID,
        languages: opts.brandLanguages ?? ['de', 'fr'],
      }),
    },
    translationKey: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(keys.filter((row) => matches(row, where)))
        ),
    },
    translationValue: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(values.filter((row) => matches(row, where)))
        ),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const error = opts.createError?.(data)
        if (error) return Promise.reject(error)
        values.push({ ...data })
        return Promise.resolve(data)
      }),
    },
  }
  const translator = {
    isEnabled: jest.fn().mockReturnValue(opts.enabled ?? true),
    translate:
      opts.translate ??
      jest.fn(async (req: any) =>
        req.items.map((item: any) => ({
          id: item.id,
          text: `${req.targetLanguage}:${item.text}`,
        }))
      ),
  }
  const changes = { recordChange: jest.fn().mockResolvedValue(undefined) }
  const auditLogs = { create: jest.fn().mockResolvedValue({}) }
  const service = new AiTranslationService(
    prisma,
    translator as any,
    changes as any,
    auditLogs as any
  )
  return { service, prisma, translator, changes, auditLogs, values }
}

const suggestDto = (extra: Record<string, unknown> = {}) => ({
  sourceLanguage: 'de',
  targetLanguage: 'en',
  keyIds: [K1, K2],
  ...extra,
})

async function errorOf(promise: Promise<unknown>): Promise<any> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('did not throw')
}

describe('AiTranslationService', () => {
  describe('suggest', () => {
    it('suggests for keys with a source and skips keys without one', async () => {
      const { service, translator } = createService({
        keys: [
          key(K1, 'home.title', { description: 'Page headline' }),
          key(K2, 'home.empty'),
        ],
        values: [val(K1, 'de', 'Hallo')],
      })

      const result = await service.suggest(PROJECT_ID, suggestDto())

      expect(result).toEqual({
        suggestions: [
          { keyId: K1, value: 'en:Hallo', placeholderMismatch: false },
        ],
        skipped: [{ keyId: K2, reason: 'no_source' }],
      })
      expect(translator.translate).toHaveBeenCalledWith({
        sourceLanguage: 'de',
        targetLanguage: 'en',
        items: [
          {
            id: K1,
            key: 'home.title',
            description: 'Page headline',
            text: 'Hallo',
          },
        ],
      })
    })

    it('never saves anything', async () => {
      const { service, prisma, changes, auditLogs } = createService({
        keys: [key(K1, 'a')],
        values: [val(K1, 'de', 'Hallo')],
      })
      await service.suggest(PROJECT_ID, suggestDto({ keyIds: [K1] }))
      expect(prisma.translationValue.create).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('does not call the translator when no key has a source', async () => {
      const { service, translator } = createService({
        keys: [key(K1, 'a')],
      })
      const result = await service.suggest(
        PROJECT_ID,
        suggestDto({ keyIds: [K1] })
      )
      expect(result.suggestions).toEqual([])
      expect(translator.translate).not.toHaveBeenCalled()
    })

    it('uses the brand override as the source before the standard text', async () => {
      const { service, translator } = createService({
        keys: [key(K1, 'a'), key(K2, 'b')],
        values: [
          val(K1, 'de', 'Standard'),
          val(K1, 'de', 'Brand-Text', BRAND_ID),
          val(K2, 'de', 'Nur Standard'),
        ],
      })

      const result = await service.suggest(
        PROJECT_ID,
        suggestDto({ brandId: BRAND_ID, targetLanguage: 'fr' })
      )

      const items = translator.translate.mock.calls[0][0].items
      expect(items.map((item: any) => item.text)).toEqual([
        'Brand-Text',
        'Nur Standard',
      ])
      expect(result.suggestions.map((s) => s.keyId)).toEqual([K1, K2])
    })

    it('flags a suggestion whose placeholders differ from the source', async () => {
      const translate = jest.fn(async () => [
        { id: K1, text: '{{Anzahl}} Dateien' },
      ])
      const { service } = createService({
        keys: [key(K1, 'a')],
        values: [val(K1, 'en', '{{count}} files')],
        translate,
      })
      const result = await service.suggest(
        PROJECT_ID,
        suggestDto({
          sourceLanguage: 'en',
          targetLanguage: 'de',
          keyIds: [K1],
        })
      )
      expect(result.suggestions).toEqual([
        { keyId: K1, value: '{{Anzahl}} Dateien', placeholderMismatch: true },
      ])
    })

    it('rejects source equal to target', async () => {
      const { service } = createService()
      await expect(
        service.suggest(PROJECT_ID, suggestDto({ targetLanguage: 'de' }))
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects languages that are not project languages', async () => {
      const { service } = createService({ keys: [key(K1, 'a'), key(K2, 'b')] })
      await expect(
        service.suggest(PROJECT_ID, suggestDto({ targetLanguage: 'it' }))
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.suggest(PROJECT_ID, suggestDto({ sourceLanguage: 'it' }))
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects a key of another project with 404', async () => {
      const { service, translator } = createService({
        keys: [key(K1, 'a'), key(FOREIGN, 'x', { projectId: 'other' })],
        values: [val(K1, 'de', 'Hallo')],
      })
      await expect(
        service.suggest(PROJECT_ID, suggestDto({ keyIds: [K1, FOREIGN] }))
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(translator.translate).not.toHaveBeenCalled()
    })

    it('rejects a target language that the brand does not have', async () => {
      const { service } = createService({
        keys: [key(K1, 'a'), key(K2, 'b')],
        brandLanguages: ['de', 'fr'],
      })
      await expect(
        service.suggest(PROJECT_ID, suggestDto({ brandId: BRAND_ID }))
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('passes a rate limit through as 429 with its code', async () => {
      const translate = jest
        .fn()
        .mockRejectedValue(new AiTranslationUnavailableError('rate_limit'))
      const { service } = createService({
        keys: [key(K1, 'a')],
        values: [val(K1, 'de', 'Hallo')],
        translate,
      })
      const error = await errorOf(
        service.suggest(PROJECT_ID, suggestDto({ keyIds: [K1] }))
      )
      expect(error).toBeInstanceOf(HttpException)
      expect(error.getStatus()).toBe(429)
      expect(error.getResponse()).toMatchObject({
        code: 'ai_translation_rate_limit',
      })
    })

    it.each([
      ['disabled', 503, 'ai_translation_disabled'],
      ['auth', 503, 'ai_translation_auth'],
      ['config', 503, 'ai_translation_config'],
      ['refused', 502, 'ai_translation_failed'],
      ['failed', 502, 'ai_translation_failed'],
    ])('maps %s to %i %s', async (reason, status, code) => {
      const translate = jest
        .fn()
        .mockRejectedValue(new AiTranslationUnavailableError(reason as any))
      const { service } = createService({
        keys: [key(K1, 'a')],
        values: [val(K1, 'de', 'Hallo')],
        translate,
      })
      const error = await errorOf(
        service.suggest(PROJECT_ID, suggestDto({ keyIds: [K1] }))
      )
      expect(error.getStatus()).toBe(status)
      expect(error.getResponse()).toMatchObject({ code })
    })

    it('drops a suggestion longer than the text limit like an omitted one', async () => {
      const translate = jest.fn(async () => [
        { id: K1, text: 'x'.repeat(10_001) },
        { id: K2, text: 'ok' },
      ])
      const { service } = createService({
        keys: [key(K1, 'a'), key(K2, 'b')],
        values: [val(K1, 'de', 'Eins'), val(K2, 'de', 'Zwei')],
        translate,
      })
      const result = await service.suggest(PROJECT_ID, suggestDto())
      expect(result.suggestions).toEqual([
        { keyId: K2, value: 'ok', placeholderMismatch: false },
      ])
      expect(result.skipped).toEqual([])
    })

    it('answers 503 ai_translation_disabled up front without a key', async () => {
      const { service, prisma } = createService({ enabled: false })
      const error = await errorOf(service.suggest(PROJECT_ID, suggestDto()))
      expect(error.getStatus()).toBe(503)
      expect(error.getResponse()).toMatchObject({
        code: 'ai_translation_disabled',
      })
      expect(prisma.translationKey.findMany).not.toHaveBeenCalled()
    })
  })

  describe('previewMissing', () => {
    const keys = [
      key(K5, 'e.five'),
      key(K1, 'a.one'),
      key(K3, 'c.three'),
      key(K2, 'b.two'),
      key(K4, 'd.four'),
    ]

    it('translates the first limit missing keys sorted by key and counts the rest', async () => {
      const { service, translator } = createService({
        keys,
        values: [
          val(K1, 'de', 'Eins'),
          val(K2, 'de', 'Zwei'),
          val(K3, 'de', 'Drei'),
          val(K4, 'de', 'Vier'),
          val(K5, 'de', 'Fuenf'),
          val(K1, 'fr', 'Un'),
          val(K4, 'fr', 'Quatre'),
        ],
      })
      // fr misses b.two, c.three, e.five -> three missing, limit 2.
      const result = await service.previewMissing(PROJECT_ID, {
        sourceLanguage: 'de',
        targetLanguages: ['fr'],
        limit: 2,
      })

      expect(result.languages).toHaveLength(1)
      const fr = result.languages[0]
      expect(fr.language).toBe('fr')
      expect(fr.remaining).toBe(1)
      expect(fr.suggestions).toEqual([
        {
          keyId: K2,
          key: 'b.two',
          source: 'Zwei',
          value: 'fr:Zwei',
          placeholderMismatch: false,
        },
        {
          keyId: K3,
          key: 'c.three',
          source: 'Drei',
          value: 'fr:Drei',
          placeholderMismatch: false,
        },
      ])
      expect(translator.translate).toHaveBeenCalledTimes(1)
    })

    it('ignores keys without a source text and brand overrides', async () => {
      const { service } = createService({
        keys: [key(K1, 'a'), key(K2, 'b')],
        values: [
          val(K1, 'de', 'Eins'),
          val(K2, 'de', 'Zwei', BRAND_ID),
          val(K2, 'fr', 'Deux', BRAND_ID),
        ],
      })
      const result = await service.previewMissing(PROJECT_ID, {
        sourceLanguage: 'de',
        targetLanguages: ['fr'],
      })
      expect(result.languages[0].suggestions.map((s) => s.keyId)).toEqual([K1])
      expect(result.languages[0].remaining).toBe(0)
    })

    it('defaults the limit to 40 and the namespace to translation', async () => {
      const many = Array.from({ length: 45 }, (_, i) =>
        key(`${i}`.padStart(24, '0'), `k.${String(i).padStart(3, '0')}`)
      )
      const { service } = createService({
        keys: [...many, key(FOREIGN, 'other', { namespace: 'admin' })],
        values: [
          ...many.map((row) => val(row.id, 'de', 'x')),
          val(FOREIGN, 'de', 'y'),
        ],
      })
      const result = await service.previewMissing(PROJECT_ID, {
        sourceLanguage: 'de',
        targetLanguages: ['en'],
      })
      expect(result.languages[0].suggestions).toHaveLength(40)
      expect(result.languages[0].remaining).toBe(5)
    })

    it('drops a suggestion longer than the text limit like an omitted one', async () => {
      const translate = jest.fn(async () => [
        { id: K1, text: 'ok' },
        { id: K2, text: 'x'.repeat(10_001) },
      ])
      const { service } = createService({
        keys: [key(K1, 'a'), key(K2, 'b')],
        values: [val(K1, 'de', 'Eins'), val(K2, 'de', 'Zwei')],
        translate,
      })
      const result = await service.previewMissing(PROJECT_ID, {
        sourceLanguage: 'de',
        targetLanguages: ['fr'],
      })
      expect(result.languages[0].suggestions.map((s) => s.keyId)).toEqual([K1])
      expect(result.languages[0].remaining).toBe(0)
    })

    it('returns an entry without a call for a language with nothing missing', async () => {
      const { service, translator } = createService({
        keys: [key(K1, 'a')],
        values: [val(K1, 'de', 'Eins'), val(K1, 'en', 'One')],
      })
      const result = await service.previewMissing(PROJECT_ID, {
        sourceLanguage: 'de',
        targetLanguages: ['en'],
      })
      expect(result).toEqual({
        languages: [{ language: 'en', remaining: 0, suggestions: [] }],
      })
      expect(translator.translate).not.toHaveBeenCalled()
    })

    it('rejects source among the targets and unknown languages', async () => {
      const { service } = createService()
      await expect(
        service.previewMissing(PROJECT_ID, {
          sourceLanguage: 'de',
          targetLanguages: ['de', 'en'],
        })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.previewMissing(PROJECT_ID, {
          sourceLanguage: 'de',
          targetLanguages: ['it'],
        })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.previewMissing(PROJECT_ID, {
          sourceLanguage: 'it',
          targetLanguages: ['en'],
        })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('answers 503 ai_translation_disabled without a key', async () => {
      const { service } = createService({ enabled: false })
      const error = await errorOf(
        service.previewMissing(PROJECT_ID, {
          sourceLanguage: 'de',
          targetLanguages: ['en'],
        })
      )
      expect(error.getResponse()).toMatchObject({
        code: 'ai_translation_disabled',
      })
    })
  })

  describe('apply', () => {
    const keys = [key(K1, 'a'), key(K2, 'b'), key(K3, 'c')]
    const dto = (extra: Record<string, unknown> = {}) => ({
      targetLanguage: 'en',
      values: [
        { keyId: K1, value: 'One' },
        { keyId: K2, value: 'Two' },
        { keyId: K3, value: 'Three' },
      ],
      ...extra,
    })

    it('writes only missing texts and records one change and one audit entry', async () => {
      const { service, values, changes, auditLogs } = createService({
        keys,
        values: [val(K2, 'en', 'Already there')],
      })

      const result = await service.apply(PROJECT_ID, USER_ID, dto())

      expect(result).toEqual({ written: 2, skippedExisting: 1 })
      expect(
        values.find((row) => row.keyId === K2 && row.language === 'en')?.value
      ).toBe('Already there')
      expect(
        values.filter((row) => row.language === 'en' && row.scope === 'default')
      ).toHaveLength(3)
      expect(changes.recordChange).toHaveBeenCalledTimes(1)
      expect(changes.recordChange).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        changes: [{ language: 'en', action: 'ai_translated' }],
      })
      expect(auditLogs.create).toHaveBeenCalledTimes(1)
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'translation.ai_translated',
          entityType: 'Project',
          entityId: PROJECT_ID,
          userId: USER_ID,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          newValues: { language: 'en', scope: 'default', count: 2 },
        })
      )
    })

    it('stores the user and project on new texts', async () => {
      const { service, prisma } = createService({ keys })
      await service.apply(PROJECT_ID, USER_ID, dto())
      expect(prisma.translationValue.create).toHaveBeenCalledWith({
        data: {
          keyId: K1,
          projectId: PROJECT_ID,
          language: 'en',
          scope: 'default',
          value: 'One',
          updatedById: USER_ID,
        },
      })
    })

    it('writes into the brand scope for a brand', async () => {
      const { service, values, auditLogs } = createService({
        keys,
        values: [val(K1, 'fr', 'Standard-Fr')],
      })
      const result = await service.apply(
        PROJECT_ID,
        USER_ID,
        dto({ targetLanguage: 'fr', brandId: BRAND_ID })
      )
      // The standard text does not block the brand override.
      expect(result).toEqual({ written: 3, skippedExisting: 0 })
      expect(values.filter((row) => row.scope === BRAND_ID)).toHaveLength(3)
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          newValues: { language: 'fr', scope: BRAND_ID, count: 3 },
        })
      )
    })

    it('counts a unique index violation while writing as skippedExisting', async () => {
      const { service, changes, auditLogs } = createService({
        keys,
        createError: (data) =>
          data.keyId === K3
            ? Object.assign(new Error('dup'), { code: 'P2002' })
            : null,
      })
      const result = await service.apply(PROJECT_ID, USER_ID, dto())
      expect(result).toEqual({ written: 2, skippedExisting: 1 })
      expect(changes.recordChange).toHaveBeenCalledTimes(1)
      expect(auditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          newValues: { language: 'en', scope: 'default', count: 2 },
        })
      )
    })

    it('rethrows other write errors', async () => {
      const { service } = createService({
        keys,
        createError: () => new Error('db down'),
      })
      await expect(service.apply(PROJECT_ID, USER_ID, dto())).rejects.toThrow(
        'db down'
      )
    })

    it('rejects an empty value for the whole request and writes nothing', async () => {
      const { service, prisma } = createService({ keys })
      await expect(
        service.apply(
          PROJECT_ID,
          USER_ID,
          dto({
            values: [
              { keyId: K1, value: 'One' },
              { keyId: K2, value: '   ' },
            ],
          })
        )
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.translationValue.create).not.toHaveBeenCalled()
    })

    it('rejects an oversize value, a duplicate key and a foreign key without writing', async () => {
      const { service, prisma } = createService({ keys })
      await expect(
        service.apply(
          PROJECT_ID,
          USER_ID,
          dto({ values: [{ keyId: K1, value: 'x'.repeat(10_001) }] })
        )
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.apply(
          PROJECT_ID,
          USER_ID,
          dto({
            values: [
              { keyId: K1, value: 'a' },
              { keyId: K1, value: 'b' },
            ],
          })
        )
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.apply(
          PROJECT_ID,
          USER_ID,
          dto({
            values: [
              { keyId: K1, value: 'a' },
              { keyId: FOREIGN, value: 'b' },
            ],
          })
        )
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.translationValue.create).not.toHaveBeenCalled()
    })

    it('rejects a language outside the view', async () => {
      const { service, prisma } = createService({
        keys,
        brandLanguages: ['de', 'fr'],
      })
      await expect(
        service.apply(PROJECT_ID, USER_ID, dto({ targetLanguage: 'it' }))
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.apply(PROJECT_ID, USER_ID, dto({ brandId: BRAND_ID }))
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.translationValue.create).not.toHaveBeenCalled()
    })

    it('records nothing when all texts already exist', async () => {
      const { service, changes, auditLogs, prisma } = createService({
        keys,
        values: [val(K1, 'en', 'a'), val(K2, 'en', 'b'), val(K3, 'en', 'c')],
      })
      const result = await service.apply(PROJECT_ID, USER_ID, dto())
      expect(result).toEqual({ written: 0, skippedExisting: 3 })
      expect(prisma.translationValue.create).not.toHaveBeenCalled()
      expect(changes.recordChange).not.toHaveBeenCalled()
      expect(auditLogs.create).not.toHaveBeenCalled()
    })

    it('works without an API key and never calls the translator', async () => {
      const { service, translator } = createService({ keys, enabled: false })
      const result = await service.apply(PROJECT_ID, USER_ID, dto())
      expect(result.written).toBe(3)
      expect(translator.translate).not.toHaveBeenCalled()
    })
  })
})
