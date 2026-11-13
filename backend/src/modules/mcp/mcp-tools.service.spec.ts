import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { runWithActor } from '../../shared/actor-context'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { MAX_VALUE_LENGTH } from '../translations/limits'
import { TranslationsService } from '../translations/translations.service'
import { McpAiRateLimiter } from './mcp-ai-rate-limiter'
import { McpContext } from './mcp-key.resolver'
import { McpToolError, McpToolsService } from './mcp-tools.service'

const ctx = (role: McpContext['role'] = 'MEMBER'): McpContext => ({
  apiKeyId: 'k1',
  apiKeyName: 'Claude',
  userId: 'u1',
  organizationId: 'o1',
  projectId: 'p1',
  role,
})

const project = {
  id: 'p1',
  organizationId: 'o1',
  key: 'shop',
  name: 'Shop',
  type: 'MULTI',
  languages: ['de', 'en'],
  namespaces: ['translation', 'admin'],
}

const brands = [
  { id: 'b1', key: 'acme', name: 'Acme', languages: ['de', 'fr'] },
]

const keyRow = (over: Record<string, unknown> = {}) => ({
  id: 'key1',
  projectId: 'p1',
  organizationId: 'o1',
  namespace: 'translation',
  key: 'home.title',
  description: 'Title',
  ...over,
})

function setup(limiter = new McpAiRateLimiter(() => 0)) {
  const prisma: any = {
    project: { findFirst: jest.fn().mockResolvedValue(project) },
    brand: { findMany: jest.fn().mockResolvedValue(brands) },
    translationKey: {
      findFirst: jest.fn().mockResolvedValue(keyRow()),
      findMany: jest.fn().mockResolvedValue([]),
    },
    translationValue: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(3),
    },
  }
  const translations: any = {
    getTable: jest.fn(),
    createKey: jest.fn().mockImplementation(async (_p, _u, dto) => ({
      id: 'new1',
      namespace: dto.namespace ?? 'translation',
      key: dto.key,
    })),
    updateKey: jest.fn().mockImplementation(async (_id, _u, dto) => ({
      id: 'key1',
      namespace: 'translation',
      key: dto.key ?? 'home.title',
    })),
    deleteKey: jest.fn().mockResolvedValue(undefined),
    setValue: jest.fn().mockResolvedValue({ value: 'x', inherited: false }),
  }
  const ai: any = { isEnabled: jest.fn().mockReturnValue(true) }
  const aiTranslation: any = {
    previewMissing: jest.fn(),
    suggest: jest.fn(),
    apply: jest.fn(),
  }
  const settings: any = {
    setProjectLanguages: jest
      .fn()
      .mockImplementation(async (_p, _u, languages) => ({
        languages,
        removedValues: 0,
      })),
    setBrandLanguages: jest
      .fn()
      .mockImplementation(async (_b, _u, languages) => ({
        languages,
        removedValues: 0,
      })),
  }
  const service = new McpToolsService(
    prisma,
    translations,
    ai,
    aiTranslation,
    limiter,
    settings
  )
  return {
    prisma,
    translations,
    ai,
    aiTranslation,
    service,
    limiter,
    settings,
  }
}

describe('McpToolsService', () => {
  describe('get_project', () => {
    it('describes the project, its brands and the key role', async () => {
      const { service, prisma } = setup()
      await expect(service.getProject(ctx('ADMIN'))).resolves.toEqual({
        project: { key: 'shop', name: 'Shop', type: 'MULTI' },
        languages: ['de', 'en'],
        namespaces: ['translation', 'admin'],
        brands: [{ key: 'acme', name: 'Acme', languages: ['de', 'fr'] }],
        aiTranslationEnabled: true,
        role: 'ADMIN',
        canWrite: true,
      })
      expect(prisma.project.findFirst.mock.calls[0][0].where).toEqual({
        id: 'p1',
        organizationId: 'o1',
      })
      expect(prisma.brand.findMany.mock.calls[0][0].where).toEqual({
        projectId: 'p1',
      })
    })

    it('reports canWrite: false for a VIEWER', async () => {
      const { service, ai } = setup()
      ai.isEnabled.mockReturnValue(false)
      const result = await service.getProject(ctx('VIEWER'))
      expect(result.canWrite).toBe(false)
      expect(result.aiTranslationEnabled).toBe(false)
      expect(result.role).toBe('VIEWER')
    })

    it('has no brands in a SINGLE project', async () => {
      const { service, prisma } = setup()
      prisma.project.findFirst.mockResolvedValue({ ...project, type: 'SINGLE' })
      const result = await service.getProject(ctx())
      expect(result.brands).toEqual([])
      expect(prisma.brand.findMany).not.toHaveBeenCalled()
    })

    it('fails when the project is gone', async () => {
      const { service, prisma } = setup()
      prisma.project.findFirst.mockResolvedValue(null)
      await expect(service.getProject(ctx())).rejects.toThrow(McpToolError)
    })
  })

  describe('list_keys', () => {
    it('lists missing languages and brand overrides under the brand key', async () => {
      const { service, translations } = setup()
      translations.getTable.mockResolvedValue({
        languages: ['de', 'en', 'fr'],
        namespaces: ['translation', 'admin'],
        rows: [
          {
            keyId: 'key1',
            key: 'home.title',
            description: 'Title',
            values: {
              de: { value: 'Start', inherited: false },
              en: { value: null, inherited: false },
              fr: { value: null, inherited: false },
            },
            overrides: { b1: { fr: 'Accueil' } },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      })

      const result = await service.listKeys(ctx('VIEWER'), {
        namespace: 'admin',
        search: 'home',
        missingOnly: true,
        page: 2,
      })

      expect(translations.getTable).toHaveBeenCalledWith('p1', {
        namespace: 'admin',
        search: 'home',
        missingOnly: true,
        page: 2,
        pageSize: 50,
      })
      expect(result).toEqual({
        keys: [
          {
            key: 'home.title',
            description: 'Title',
            values: { de: 'Start' },
            missing: ['en'],
            brandOverrides: { acme: { fr: 'Accueil' } },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      })
    })

    it('rejects an unknown namespace and names the namespaces', async () => {
      const { service, translations } = setup()
      await expect(
        service.listKeys(ctx(), { namespace: 'nope' })
      ).rejects.toThrow('translation, admin')
      expect(translations.getTable).not.toHaveBeenCalled()
    })
  })

  describe('get_key', () => {
    it('returns one entry built from the stored texts of the project', async () => {
      const { service, prisma } = setup()
      prisma.translationValue.findMany.mockResolvedValue([
        { language: 'de', scope: 'default', value: 'Start' },
        { language: 'fr', scope: 'default', value: 'ignored' },
        { language: 'fr', scope: 'b1', value: 'Accueil' },
        { language: 'en', scope: 'b1', value: 'not a brand language' },
      ])

      const result = await service.getKey(ctx('VIEWER'), { key: 'home.title' })

      expect(result).toEqual({
        key: 'home.title',
        description: 'Title',
        locked: false,
        values: { de: 'Start' },
        missing: ['en'],
        brandOverrides: { acme: { fr: 'Accueil' } },
      })
      expect(prisma.translationKey.findFirst.mock.calls[0][0].where).toEqual({
        projectId: 'p1',
        namespace: 'translation',
        key: 'home.title',
      })
      expect(
        prisma.translationValue.findMany.mock.calls[0][0].where
      ).toMatchObject({ keyId: 'key1', projectId: 'p1' })
    })

    it('does not find a key of another project', async () => {
      const { service, prisma } = setup()
      prisma.translationKey.findFirst.mockResolvedValue(null)
      await expect(service.getKey(ctx(), { key: 'other.key' })).rejects.toThrow(
        McpToolError
      )
      await expect(service.getKey(ctx(), { key: 'other.key' })).rejects.toThrow(
        /not found/
      )
      expect(prisma.translationKey.findFirst.mock.calls[0][0].where).toEqual(
        expect.objectContaining({ projectId: 'p1' })
      )
    })
  })

  describe('create_key', () => {
    it('refuses a VIEWER and creates nothing', async () => {
      const { service, translations } = setup()
      await expect(
        service.createKey(ctx('VIEWER'), { key: 'a.b' })
      ).rejects.toThrow(McpToolError)
      expect(translations.createKey).not.toHaveBeenCalled()
    })

    it('creates the key and writes its texts', async () => {
      const { service, translations } = setup()
      const result = await service.createKey(ctx(), {
        key: 'home.title',
        namespace: 'admin',
        description: 'Title',
        values: { de: 'Start', en: 'Home' },
      })
      expect(translations.createKey).toHaveBeenCalledWith('p1', 'u1', {
        key: 'home.title',
        namespace: 'admin',
        description: 'Title',
      })
      expect(translations.setValue).toHaveBeenCalledWith('new1', 'u1', {
        language: 'de',
        value: 'Start',
      })
      expect(translations.setValue).toHaveBeenCalledWith('new1', 'u1', {
        language: 'en',
        value: 'Home',
      })
      expect(result).toEqual({
        key: 'home.title',
        namespace: 'admin',
        written: ['de', 'en'],
      })
    })

    it('names the project languages for an unknown language and creates nothing', async () => {
      const { service, translations } = setup()
      const error = await service
        .createKey(ctx(), { key: 'a.b', values: { de: 'x', xx: 'y' } })
        .catch((e) => e)
      expect(error).toBeInstanceOf(McpToolError)
      expect(error.message).toContain('"xx"')
      expect(error.message).toContain('de, en')
      expect(translations.createKey).not.toHaveBeenCalled()
      expect(translations.setValue).not.toHaveBeenCalled()
    })

    it.each([
      ['empty', ''],
      ['whitespace-only', '   \n'],
      ['too long', 'x'.repeat(MAX_VALUE_LENGTH + 1)],
    ])('rejects a %s value and creates nothing', async (_n, value) => {
      const { service, translations } = setup()
      await expect(
        service.createKey(ctx(), { key: 'a.b', values: { de: value } })
      ).rejects.toThrow(McpToolError)
      expect(translations.createKey).not.toHaveBeenCalled()
    })

    it('says the key exists and how many texts were written when a text fails', async () => {
      const { service, translations } = setup()
      translations.setValue
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('prisma exploded secret'))
      const error = await service
        .createKey(ctx(), { key: 'a.b', values: { de: 'x', en: 'y' } })
        .catch((e) => e)
      expect(error).toBeInstanceOf(McpToolError)
      expect(error.message).toContain('"a.b" was created')
      expect(error.message).toContain('1 of 2 texts were written')
      expect(error.message).not.toContain('secret')
      expect(error.message).not.toContain('prisma')
    })

    it('reports 0 written and the created key when the first text fails', async () => {
      const { service, translations } = setup()
      translations.setValue.mockRejectedValueOnce(
        new BadRequestException('Text too long')
      )
      const error = await service
        .createKey(ctx(), { key: 'a.b', values: { de: 'x' } })
        .catch((e) => e)
      expect(error).toBeInstanceOf(McpToolError)
      expect(error.message).toContain('Text too long')
      expect(error.message).toContain('was created')
      expect(error.message).toContain('0 of 1 texts were written')
    })

    it('rejects an invalid key before creating', async () => {
      const { service, translations } = setup()
      await expect(service.createKey(ctx(), { key: 'a..b' })).rejects.toThrow(
        McpToolError
      )
      expect(translations.createKey).not.toHaveBeenCalled()
    })

    it('maps a conflict of the service to a tool error with its message', async () => {
      const { service, translations } = setup()
      translations.createKey.mockRejectedValue(
        new ConflictException('Key "a.b" already exists')
      )
      await expect(service.createKey(ctx(), { key: 'a.b' })).rejects.toThrow(
        new McpToolError('Key "a.b" already exists')
      )
    })

    it('lets unexpected errors through unchanged', async () => {
      const { service, translations } = setup()
      const boom = new Error('prisma exploded')
      translations.createKey.mockRejectedValue(boom)
      await expect(service.createKey(ctx(), { key: 'a.b' })).rejects.toBe(boom)
    })
  })

  describe('update_key', () => {
    it('renames and describes a key of the project', async () => {
      const { service, translations } = setup()
      const result = await service.updateKey(ctx(), {
        key: 'home.title',
        newKey: 'home.heading',
        description: 'Heading',
      })
      expect(translations.updateKey).toHaveBeenCalledWith('key1', 'u1', {
        key: 'home.heading',
        description: 'Heading',
      })
      expect(result).toEqual({
        key: 'home.heading',
        namespace: 'translation',
        description: 'Heading',
      })
    })

    it('keeps the stored description when none is given', async () => {
      const { service } = setup()
      const result = await service.updateKey(ctx(), {
        key: 'home.title',
        newKey: 'home.heading',
      })
      expect(result.description).toBe('Title')
    })

    it('requires newKey or description', async () => {
      const { service, translations } = setup()
      await expect(
        service.updateKey(ctx(), { key: 'home.title' })
      ).rejects.toThrow(McpToolError)
      expect(translations.updateKey).not.toHaveBeenCalled()
    })

    it('refuses a VIEWER', async () => {
      const { service, translations } = setup()
      await expect(
        service.updateKey(ctx('VIEWER'), { key: 'home.title', newKey: 'x' })
      ).rejects.toThrow(McpToolError)
      expect(translations.updateKey).not.toHaveBeenCalled()
    })
  })

  describe('set_translations', () => {
    const keys = [
      { id: 'id-a', key: 'a' },
      { id: 'id-b', key: 'b' },
      { id: 'id-c', key: 'c' },
    ]

    it('rejects more than 50 entries', async () => {
      const { service, translations } = setup()
      const entries = Array.from({ length: 51 }, (_, i) => ({
        key: `k${i}`,
        values: { de: 'x' },
      }))
      await expect(service.setTranslations(ctx(), { entries })).rejects.toThrow(
        McpToolError
      )
      expect(translations.setValue).not.toHaveBeenCalled()
    })

    it('writes nothing when one of three entries is invalid and names its key', async () => {
      const { service, prisma, translations } = setup()
      prisma.translationKey.findMany.mockResolvedValue(keys)
      const error = await service
        .setTranslations(ctx(), {
          entries: [
            { key: 'a', values: { de: 'A' } },
            { key: 'b', values: { de: '' } },
            { key: 'c', values: { en: 'C' } },
          ],
        })
        .catch((e) => e)
      expect(error).toBeInstanceOf(McpToolError)
      expect(error.message).toContain('"b"')
      expect(translations.setValue).not.toHaveBeenCalled()
    })

    it.each([
      ['an unknown key', [{ key: 'zzz', values: { de: 'x' } }], '"zzz"'],
      [
        'a language outside the project',
        [{ key: 'a', values: { fr: 'x' } }],
        'de, en',
      ],
      [
        'a too long text',
        [{ key: 'a', values: { de: 'x'.repeat(MAX_VALUE_LENGTH + 1) } }],
        '"a"',
      ],
      [
        'duplicate keys',
        [
          { key: 'a', values: { de: 'x' } },
          { key: 'a', values: { en: 'y' } },
        ],
        '"a"',
      ],
      ['an entry without texts', [{ key: 'a', values: {} }], '"a"'],
      ['a whitespace-only text', [{ key: 'a', values: { de: '  \t' } }], '"a"'],
    ])('rejects %s', async (_n, entries, mention) => {
      const { service, prisma, translations } = setup()
      prisma.translationKey.findMany.mockResolvedValue(keys)
      const error = await service
        .setTranslations(ctx(), {
          entries: entries as { key: string; values: Record<string, string> }[],
        })
        .catch((e) => e)
      expect(error).toBeInstanceOf(McpToolError)
      expect(error.message).toContain(mention)
      expect(translations.setValue).not.toHaveBeenCalled()
    })

    it('writes every changed text through setValue and counts unchanged ones', async () => {
      const { service, prisma, translations } = setup()
      prisma.translationKey.findMany.mockResolvedValue(keys)
      prisma.translationValue.findMany.mockResolvedValue([
        { keyId: 'id-a', language: 'de', value: 'A' },
        { keyId: 'id-b', language: 'en', value: 'old' },
      ])

      const result = await service.setTranslations(ctx(), {
        namespace: 'admin',
        entries: [
          { key: 'a', values: { de: 'A', en: 'A-en' } },
          { key: 'b', values: { en: 'new' } },
        ],
      })

      expect(result).toEqual({ written: 2, unchanged: 1 })
      expect(translations.setValue).toHaveBeenCalledTimes(2)
      expect(translations.setValue).toHaveBeenCalledWith('id-a', 'u1', {
        language: 'en',
        value: 'A-en',
      })
      expect(translations.setValue).toHaveBeenCalledWith('id-b', 'u1', {
        language: 'en',
        value: 'new',
      })
      expect(prisma.translationKey.findMany.mock.calls[0][0].where).toEqual({
        projectId: 'p1',
        namespace: 'admin',
        key: { in: ['a', 'b'] },
      })
      expect(
        prisma.translationValue.findMany.mock.calls[0][0].where
      ).toMatchObject({ projectId: 'p1', scope: 'default' })
    })

    it('writes brand overrides in the languages of the brand', async () => {
      const { service, prisma, translations } = setup()
      prisma.translationKey.findMany.mockResolvedValue(keys)

      const result = await service.setTranslations(ctx(), {
        brandKey: 'acme',
        entries: [{ key: 'a', values: { fr: 'Bonjour' } }],
      })

      expect(result).toEqual({ written: 1, unchanged: 0 })
      expect(translations.setValue).toHaveBeenCalledWith('id-a', 'u1', {
        language: 'fr',
        brandId: 'b1',
        value: 'Bonjour',
      })
      expect(
        prisma.translationValue.findMany.mock.calls[0][0].where
      ).toMatchObject({ scope: 'b1' })
    })

    it('rejects an unknown brand and names the brands', async () => {
      const { service, prisma, translations } = setup()
      prisma.translationKey.findMany.mockResolvedValue(keys)
      const error = await service
        .setTranslations(ctx(), {
          brandKey: 'nope',
          entries: [{ key: 'a', values: { de: 'x' } }],
        })
        .catch((e) => e)
      expect(error).toBeInstanceOf(McpToolError)
      expect(error.message).toContain('acme')
      expect(translations.setValue).not.toHaveBeenCalled()
    })

    it('refuses a VIEWER', async () => {
      const { service, translations } = setup()
      await expect(
        service.setTranslations(ctx('VIEWER'), {
          entries: [{ key: 'a', values: { de: 'x' } }],
        })
      ).rejects.toThrow(McpToolError)
      expect(translations.setValue).not.toHaveBeenCalled()
    })

    it('maps a service error during writing to a tool error', async () => {
      const { service, prisma, translations } = setup()
      prisma.translationKey.findMany.mockResolvedValue(keys)
      translations.setValue.mockRejectedValue(
        new NotFoundException('Translation key not found')
      )
      await expect(
        service.setTranslations(ctx(), {
          entries: [{ key: 'a', values: { de: 'x' } }],
        })
      ).rejects.toThrow(new McpToolError('Translation key not found'))
    })
  })

  describe('set_translations partial failure', () => {
    it('does not double the period of a message that ends with one', async () => {
      const { service, prisma, translations } = setup()
      prisma.translationKey.findMany.mockResolvedValue([
        { id: 'id-a', key: 'a' },
      ])
      translations.setValue
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new BadRequestException('Too long.'))
      const error = await service
        .setTranslations(ctx(), {
          entries: [{ key: 'a', values: { de: 'A', en: 'B' } }],
        })
        .catch((e) => e)
      expect(error.message).toContain('Too long. 1 of 2')
      expect(error.message).not.toContain('..')
    })

    it('says how many texts were written before the error, without internals', async () => {
      const { service, prisma, translations } = setup()
      prisma.translationKey.findMany.mockResolvedValue([
        { id: 'id-a', key: 'a' },
        { id: 'id-b', key: 'b' },
      ])
      translations.setValue
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('prisma exploded secret'))
      const error = await service
        .setTranslations(ctx(), {
          entries: [
            { key: 'a', values: { de: 'A', en: 'A' } },
            { key: 'b', values: { de: 'B' } },
          ],
        })
        .catch((e) => e)
      expect(error).toBeInstanceOf(McpToolError)
      expect(error.message).toContain(
        '2 of 3 texts were written before the error'
      )
      expect(error.message).not.toContain('secret')
    })

    it('lets the original error through when nothing was written yet', async () => {
      const { service, prisma, translations } = setup()
      prisma.translationKey.findMany.mockResolvedValue([
        { id: 'id-a', key: 'a' },
      ])
      const boom = new Error('boom')
      translations.setValue.mockRejectedValue(boom)
      await expect(
        service.setTranslations(ctx(), {
          entries: [{ key: 'a', values: { de: 'A' } }],
        })
      ).rejects.toBe(boom)
    })
  })

  describe('translate_missing', () => {
    const preview = (suggestions: any[], remaining = 0) => ({
      languages: [{ language: 'en', remaining, suggestions }],
    })
    const sug = (n: string, over: Record<string, unknown> = {}) => ({
      keyId: `id-${n}`,
      key: n,
      source: `Quelle ${n}`,
      value: `Source ${n}`,
      placeholderMismatch: false,
      ...over,
    })
    const input = { sourceLanguage: 'de', targetLanguage: 'en' }

    it('refuses a VIEWER before anything else', async () => {
      const { service, prisma, aiTranslation } = setup()
      await expect(
        service.translateMissing(ctx('VIEWER'), input)
      ).rejects.toThrow(McpToolError)
      expect(prisma.project.findFirst).not.toHaveBeenCalled()
      expect(aiTranslation.previewMissing).not.toHaveBeenCalled()
    })

    it('previews the next 40 missing texts of the namespace without writing', async () => {
      const { service, aiTranslation } = setup()
      aiTranslation.previewMissing.mockResolvedValue(
        preview([sug('a'), sug('b')], 7)
      )
      const result = await service.translateMissing(ctx(), {
        ...input,
        namespace: 'admin',
      })
      expect(aiTranslation.previewMissing).toHaveBeenCalledWith('p1', {
        sourceLanguage: 'de',
        targetLanguages: ['en'],
        namespace: 'admin',
        limit: 40,
      })
      expect(aiTranslation.apply).not.toHaveBeenCalled()
      expect(result).toEqual({
        suggestions: [
          { key: 'a', source: 'Quelle a', value: 'Source a' },
          { key: 'b', source: 'Quelle b', value: 'Source b' },
        ],
        needsReview: [],
        applied: 0,
        skippedExisting: 0,
        remaining: 7,
      })
    })

    it('applies only the entries without a placeholder mismatch', async () => {
      const { service, aiTranslation } = setup()
      aiTranslation.previewMissing.mockResolvedValue(
        preview([sug('a'), sug('b', { placeholderMismatch: true }), sug('c')])
      )
      aiTranslation.apply.mockResolvedValue({ written: 1, skippedExisting: 1 })
      const result = await service.translateMissing(ctx(), {
        ...input,
        apply: true,
      })
      expect(aiTranslation.apply).toHaveBeenCalledWith('p1', 'u1', {
        targetLanguage: 'en',
        values: [
          { keyId: 'id-a', value: 'Source a' },
          { keyId: 'id-c', value: 'Source c' },
        ],
      })
      expect(result.applied).toBe(1)
      expect(result.skippedExisting).toBe(1)
      expect(result.suggestions.map((s) => s.key)).toEqual(['a', 'c'])
      expect(result.needsReview).toEqual([
        {
          key: 'b',
          source: 'Quelle b',
          value: 'Source b',
          reason: 'placeholders',
        },
      ])
    })

    describe('when storing fails', () => {
      const twoSuggestions = () =>
        preview([sug('a'), sug('b', { placeholderMismatch: true }), sug('c')])

      it('keeps the suggestions and reports a generic applyError without internals', async () => {
        const { service, aiTranslation } = setup()
        const log = jest.spyOn(Logger.prototype, 'error').mockImplementation()
        aiTranslation.previewMissing.mockResolvedValue(twoSuggestions())
        aiTranslation.apply.mockRejectedValue(new Error('prisma secret'))
        const result: any = await service.translateMissing(ctx(), {
          ...input,
          apply: true,
        })
        expect(result.suggestions.map((s: any) => s.key)).toEqual(['a', 'c'])
        expect(result.needsReview).toHaveLength(1)
        expect(result.applied).toBe(0)
        expect(result.skippedExisting).toBe(0)
        expect(result.applyError).toContain('set_translations')
        expect(result.applyError).toContain('get_key')
        expect(result.applyError).toContain('may already')
        expect(JSON.stringify(result)).not.toContain('secret')
        expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
        expect(log).toHaveBeenCalled()
        log.mockRestore()
      })

      it('appends the message of a validation exception', async () => {
        const { service, aiTranslation } = setup()
        aiTranslation.previewMissing.mockResolvedValue(twoSuggestions())
        aiTranslation.apply.mockRejectedValue(
          new BadRequestException('Values must not be empty')
        )
        const result: any = await service.translateMissing(ctx(), {
          ...input,
          apply: true,
        })
        expect(result.applyError).toContain('Values must not be empty')
        expect(result.suggestions).toHaveLength(2)
      })

      it('has no applyError when apply succeeds or is off', async () => {
        const { service, aiTranslation } = setup()
        aiTranslation.previewMissing.mockResolvedValue(twoSuggestions())
        aiTranslation.apply.mockResolvedValue({
          written: 2,
          skippedExisting: 0,
        })
        const on = await service.translateMissing(ctx(), {
          ...input,
          apply: true,
        })
        const off = await service.translateMissing(ctx(), input)
        expect('applyError' in on).toBe(false)
        expect('applyError' in off).toBe(false)
      })
    })

    it('does not call apply when only needsReview entries exist', async () => {
      const { service, aiTranslation } = setup()
      aiTranslation.previewMissing.mockResolvedValue(
        preview([sug('b', { placeholderMismatch: true })])
      )
      const result = await service.translateMissing(ctx(), {
        ...input,
        apply: true,
      })
      expect(aiTranslation.apply).not.toHaveBeenCalled()
      expect(result.applied).toBe(0)
    })

    it('drops blank suggestions and never applies them', async () => {
      const { service, aiTranslation } = setup()
      aiTranslation.previewMissing.mockResolvedValue(
        preview([sug('a', { value: '  ' }), sug('b')])
      )
      aiTranslation.apply.mockResolvedValue({ written: 1, skippedExisting: 0 })
      const result = await service.translateMissing(ctx(), {
        ...input,
        apply: true,
      })
      expect(result.suggestions.map((s) => s.key)).toEqual(['b'])
      expect(aiTranslation.apply.mock.calls[0][2].values).toEqual([
        { keyId: 'id-b', value: 'Source b' },
      ])
    })

    describe('with keys', () => {
      it('suggests only for keys with a source and without a target text', async () => {
        const { service, prisma, aiTranslation } = setup()
        prisma.translationKey.findMany.mockResolvedValue([
          { id: 'id-a', key: 'a' },
          { id: 'id-b', key: 'b' },
          { id: 'id-c', key: 'c' },
        ])
        prisma.translationValue.findMany.mockResolvedValue([
          { keyId: 'id-a', language: 'de', value: 'Quelle a' },
          { keyId: 'id-b', language: 'de', value: 'Quelle b' },
          { keyId: 'id-b', language: 'en', value: 'exists' },
        ])
        aiTranslation.suggest.mockResolvedValue({
          suggestions: [
            { keyId: 'id-a', value: 'Source a', placeholderMismatch: false },
          ],
          skipped: [],
        })
        const result = await service.translateMissing(ctx(), {
          ...input,
          keys: ['a', 'b', 'c'],
        })
        expect(prisma.translationKey.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              projectId: 'p1',
              namespace: 'translation',
              key: { in: ['a', 'b', 'c'] },
            },
          })
        )
        expect(aiTranslation.suggest).toHaveBeenCalledWith('p1', {
          sourceLanguage: 'de',
          targetLanguage: 'en',
          keyIds: ['id-a'],
        })
        expect(result).toEqual({
          suggestions: [{ key: 'a', source: 'Quelle a', value: 'Source a' }],
          needsReview: [],
          applied: 0,
          skippedExisting: 0,
          remaining: 0,
        })
      })

      it('does not call the AI when nothing is left to translate', async () => {
        const { service, prisma, aiTranslation } = setup()
        prisma.translationKey.findMany.mockResolvedValue([
          { id: 'id-a', key: 'a' },
        ])
        const result = await service.translateMissing(ctx(), {
          ...input,
          keys: ['a'],
          apply: true,
        })
        expect(aiTranslation.suggest).not.toHaveBeenCalled()
        expect(aiTranslation.apply).not.toHaveBeenCalled()
        expect(result.suggestions).toEqual([])
      })

      it('routes a mismatch to needsReview and applies the rest', async () => {
        const { service, prisma, aiTranslation } = setup()
        prisma.translationKey.findMany.mockResolvedValue([
          { id: 'id-a', key: 'a' },
          { id: 'id-b', key: 'b' },
        ])
        prisma.translationValue.findMany.mockResolvedValue([
          { keyId: 'id-a', language: 'de', value: 'Hallo {{n}}' },
          { keyId: 'id-b', language: 'de', value: 'Tschüss' },
        ])
        aiTranslation.suggest.mockResolvedValue({
          suggestions: [
            { keyId: 'id-a', value: 'Hello', placeholderMismatch: true },
            { keyId: 'id-b', value: 'Bye', placeholderMismatch: false },
          ],
          skipped: [],
        })
        aiTranslation.apply.mockResolvedValue({
          written: 1,
          skippedExisting: 0,
        })
        const result = await service.translateMissing(ctx(), {
          ...input,
          keys: ['a', 'b'],
          apply: true,
        })
        expect(aiTranslation.apply).toHaveBeenCalledWith('p1', 'u1', {
          targetLanguage: 'en',
          values: [{ keyId: 'id-b', value: 'Bye' }],
        })
        expect(result.needsReview).toEqual([
          {
            key: 'a',
            source: 'Hallo {{n}}',
            value: 'Hello',
            reason: 'placeholders',
          },
        ])
        expect(result.applied).toBe(1)
      })

      it('names unknown keys and calls nothing', async () => {
        const { service, prisma, aiTranslation } = setup()
        prisma.translationKey.findMany.mockResolvedValue([
          { id: 'id-a', key: 'a' },
        ])
        const error = await service
          .translateMissing(ctx(), { ...input, keys: ['a', 'zzz'] })
          .catch((e) => e)
        expect(error).toBeInstanceOf(McpToolError)
        expect(error.message).toContain('"zzz"')
        expect(aiTranslation.suggest).not.toHaveBeenCalled()
      })

      it('rejects 41 keys and an empty list', async () => {
        const { service, aiTranslation } = setup()
        const many = Array.from({ length: 41 }, (_, i) => `k${i}`)
        await expect(
          service.translateMissing(ctx(), { ...input, keys: many })
        ).rejects.toThrow(McpToolError)
        await expect(
          service.translateMissing(ctx(), { ...input, keys: [] })
        ).rejects.toThrow(McpToolError)
        expect(aiTranslation.suggest).not.toHaveBeenCalled()
      })
    })

    it.each([
      ['source equals target', { sourceLanguage: 'de', targetLanguage: 'de' }],
      [
        'an unknown target language',
        { sourceLanguage: 'de', targetLanguage: 'xx' },
      ],
      [
        'an unknown source language',
        { sourceLanguage: 'xx', targetLanguage: 'en' },
      ],
    ])('rejects %s', async (_n, langs) => {
      const { service, aiTranslation } = setup()
      await expect(service.translateMissing(ctx(), langs)).rejects.toThrow(
        McpToolError
      )
      expect(aiTranslation.previewMissing).not.toHaveBeenCalled()
    })

    it('rejects an unknown namespace', async () => {
      const { service } = setup()
      await expect(
        service.translateMissing(ctx(), { ...input, namespace: 'nope' })
      ).rejects.toThrow(McpToolError)
    })

    describe('AI translation limit', () => {
      const LIMIT_TEXT = 'limit of 20 calls per minute'

      it('refuses the 21st call within a minute without calling the AI', async () => {
        let now = 0
        const { service, aiTranslation } = setup(
          new McpAiRateLimiter(() => now)
        )
        aiTranslation.previewMissing.mockResolvedValue(preview([sug('a')]))
        for (let i = 0; i < 20; i++) {
          await service.translateMissing(ctx(), input)
          now += 1_000
        }
        expect(aiTranslation.previewMissing).toHaveBeenCalledTimes(20)

        const error = await service
          .translateMissing(ctx(), { ...input, apply: true })
          .catch((e) => e)
        expect(error).toBeInstanceOf(McpToolError)
        expect(error.message).toContain(LIMIT_TEXT)
        expect(error.message).toContain('about a minute')
        expect(aiTranslation.previewMissing).toHaveBeenCalledTimes(20)
        expect(aiTranslation.apply).not.toHaveBeenCalled()

        now = 60_000
        await expect(
          service.translateMissing(ctx(), input)
        ).resolves.toBeDefined()
        expect(aiTranslation.previewMissing).toHaveBeenCalledTimes(21)
      })

      it('refuses the 21st call with keys without calling the AI', async () => {
        const { service, prisma, aiTranslation } = setup()
        prisma.translationKey.findMany.mockResolvedValue([
          { id: 'id-a', key: 'a' },
        ])
        prisma.translationValue.findMany.mockResolvedValue([
          { keyId: 'id-a', language: 'de', value: 'Quelle a' },
        ])
        aiTranslation.suggest.mockResolvedValue({
          suggestions: [],
          skipped: [],
        })
        const withKeys = { ...input, keys: ['a'] }
        for (let i = 0; i < 20; i++) {
          await service.translateMissing(ctx(), withKeys)
        }
        await expect(service.translateMissing(ctx(), withKeys)).rejects.toThrow(
          LIMIT_TEXT
        )
        expect(aiTranslation.suggest).toHaveBeenCalledTimes(20)
      })

      it('shares the budget between two keys of the same user', async () => {
        const { service, aiTranslation } = setup()
        aiTranslation.previewMissing.mockResolvedValue(preview([]))
        const keyA = { ...ctx(), apiKeyId: 'kA' }
        const keyB = { ...ctx(), apiKeyId: 'kB' }
        for (let i = 0; i < 10; i++) {
          await service.translateMissing(keyA, input)
          await service.translateMissing(keyB, input)
        }
        await expect(service.translateMissing(keyB, input)).rejects.toThrow(
          LIMIT_TEXT
        )
        await expect(service.translateMissing(keyA, input)).rejects.toThrow(
          LIMIT_TEXT
        )
      })

      it('keeps separate budgets for two users', async () => {
        const { service, aiTranslation } = setup()
        aiTranslation.previewMissing.mockResolvedValue(preview([]))
        for (let i = 0; i < 20; i++) {
          await service.translateMissing(ctx(), input)
        }
        await expect(service.translateMissing(ctx(), input)).rejects.toThrow(
          LIMIT_TEXT
        )
        await expect(
          service.translateMissing({ ...ctx(), userId: 'u2' }, input)
        ).resolves.toBeDefined()
      })

      it('does not use up the budget with invalid calls', async () => {
        const { service, prisma, aiTranslation } = setup()
        aiTranslation.previewMissing.mockResolvedValue(preview([]))
        prisma.translationKey.findMany.mockResolvedValue([])
        for (let i = 0; i < 25; i++) {
          await service
            .translateMissing(ctx(), { ...input, targetLanguage: 'xx' })
            .catch(() => undefined)
          await service
            .translateMissing(ctx(), { ...input, namespace: 'nope' })
            .catch(() => undefined)
          await service
            .translateMissing(ctx(), { ...input, keys: ['zzz'] })
            .catch(() => undefined)
          await service
            .translateMissing(ctx('VIEWER'), input)
            .catch(() => undefined)
        }
        for (let i = 0; i < 20; i++) {
          await service.translateMissing(ctx(), input)
        }
        expect(aiTranslation.previewMissing).toHaveBeenCalledTimes(20)
      })
    })

    describe('AI errors', () => {
      const withCode = (code: string, status = 503) =>
        new HttpException({ message: 'internal wording', code }, status)

      it('tells to use set_translations when the AI is not enabled', async () => {
        const { service, aiTranslation } = setup()
        aiTranslation.previewMissing.mockRejectedValue(
          new ServiceUnavailableException({
            message: 'x',
            code: 'ai_translation_disabled',
          })
        )
        await expect(
          service.translateMissing(ctx(), { ...input, apply: true })
        ).rejects.toThrow(
          new McpToolError(
            'AI translation is not enabled on this instance. Translate the texts yourself and store them with set_translations.'
          )
        )
        expect(aiTranslation.apply).not.toHaveBeenCalled()
      })

      it.each([
        ['ai_translation_auth', 'not set up correctly'],
        ['ai_translation_config', 'not set up correctly'],
        ['ai_translation_rate_limit', 'busy'],
        ['ai_translation_failed', 'failed'],
      ])(
        'maps %s to its own message and writes nothing',
        async (code, word) => {
          const { service, aiTranslation } = setup()
          aiTranslation.previewMissing.mockRejectedValue(withCode(code))
          const error = await service
            .translateMissing(ctx(), { ...input, apply: true })
            .catch((e) => e)
          expect(error).toBeInstanceOf(McpToolError)
          expect(error.message).toContain(word)
          expect(error.message).not.toContain('internal wording')
          expect(aiTranslation.apply).not.toHaveBeenCalled()
        }
      )

      it('uses different messages for rate limit and failure', async () => {
        const { service, aiTranslation } = setup()
        aiTranslation.previewMissing.mockRejectedValueOnce(
          withCode('ai_translation_rate_limit', 429)
        )
        aiTranslation.previewMissing.mockRejectedValueOnce(
          new BadGatewayException({
            message: 'm',
            code: 'ai_translation_failed',
          })
        )
        const a = await service.translateMissing(ctx(), input).catch((e) => e)
        const b = await service.translateMissing(ctx(), input).catch((e) => e)
        expect(a.message).not.toBe(b.message)
      })

      it('lets unknown errors through', async () => {
        const { service, aiTranslation } = setup()
        const boom = new Error('boom')
        aiTranslation.previewMissing.mockRejectedValue(boom)
        await expect(service.translateMissing(ctx(), input)).rejects.toBe(boom)
      })
    })
  })

  describe('delete_key', () => {
    it('without confirm reports the number of texts and deletes nothing', async () => {
      const { service, prisma, translations } = setup()
      const result = await service.deleteKey(ctx('ADMIN'), {
        key: 'home.title',
        confirm: false,
      })
      expect(result).toEqual({ wouldDelete: { key: 'home.title', texts: 3 } })
      expect(prisma.translationValue.count).toHaveBeenCalledWith({
        where: { keyId: 'key1', projectId: 'p1' },
      })
      expect(translations.deleteKey).not.toHaveBeenCalled()
    })

    it('refuses a locked key, with and without confirm', async () => {
      const { service, prisma, translations } = setup()
      prisma.translationKey.findFirst.mockResolvedValue({
        ...keyRow(),
        locked: true,
      })
      for (const confirm of [false, true]) {
        await expect(
          service.deleteKey(ctx('ADMIN'), { key: 'home.title', confirm })
        ).rejects.toThrow(/is locked and cannot be deleted/)
      }
      expect(prisma.translationValue.count).not.toHaveBeenCalled()
      expect(translations.deleteKey).not.toHaveBeenCalled()
    })

    it('refuses a MEMBER', async () => {
      const { service, translations } = setup()
      await expect(
        service.deleteKey(ctx('MEMBER'), { key: 'home.title', confirm: true })
      ).rejects.toThrow(McpToolError)
      expect(translations.deleteKey).not.toHaveBeenCalled()
    })

    it('deletes as ADMIN with confirm', async () => {
      const { service, translations } = setup()
      await expect(
        service.deleteKey(ctx('ADMIN'), { key: 'home.title', confirm: true })
      ).resolves.toEqual({ deleted: true })
      expect(translations.deleteKey).toHaveBeenCalledWith('key1', 'u1')
    })

    it('maps a bad request of the service to a tool error', async () => {
      const { service, translations } = setup()
      translations.deleteKey.mockRejectedValue(new BadRequestException('Nope'))
      await expect(
        service.deleteKey(ctx('OWNER'), { key: 'home.title', confirm: true })
      ).rejects.toThrow(new McpToolError('Nope'))
    })
  })

  describe('add_language', () => {
    it('appends a project language, guarded by the list it read', async () => {
      const { service, settings } = setup()
      await expect(
        service.addLanguage(ctx('ADMIN'), { language: 'fr' })
      ).resolves.toEqual({ languages: ['de', 'en', 'fr'], added: true })
      expect(settings.setProjectLanguages).toHaveBeenCalledWith(
        'p1',
        'u1',
        ['de', 'en', 'fr'],
        ['de', 'en']
      )
      expect(settings.setBrandLanguages).not.toHaveBeenCalled()
    })

    it('appends a brand language with brandKey', async () => {
      const { service, settings } = setup()
      await expect(
        service.addLanguage(ctx('OWNER'), { language: 'en', brandKey: 'acme' })
      ).resolves.toEqual({
        brandKey: 'acme',
        languages: ['de', 'fr', 'en'],
        added: true,
      })
      expect(settings.setBrandLanguages).toHaveBeenCalledWith(
        'b1',
        'u1',
        ['de', 'fr', 'en'],
        ['de', 'fr']
      )
      expect(settings.setProjectLanguages).not.toHaveBeenCalled()
    })

    it('writes nothing when the language is already there', async () => {
      const { service, settings } = setup()
      await expect(
        service.addLanguage(ctx('ADMIN'), { language: 'en' })
      ).resolves.toEqual({ languages: ['de', 'en'], added: false })
      expect(settings.setProjectLanguages).not.toHaveBeenCalled()
    })

    it('refuses a MEMBER', async () => {
      const { service, settings, prisma } = setup()
      await expect(
        service.addLanguage(ctx('MEMBER'), { language: 'fr' })
      ).rejects.toThrow(/requires ADMIN/)
      expect(prisma.project.findFirst).not.toHaveBeenCalled()
      expect(settings.setProjectLanguages).not.toHaveBeenCalled()
    })

    it('rejects an invalid language code', async () => {
      const { service, settings } = setup()
      for (const language of ['f', 'de_DE', '', undefined as any]) {
        await expect(
          service.addLanguage(ctx('ADMIN'), { language })
        ).rejects.toThrow(/Invalid language code/)
      }
      expect(settings.setProjectLanguages).not.toHaveBeenCalled()
    })

    it('rejects an unknown brand', async () => {
      const { service, settings } = setup()
      await expect(
        service.addLanguage(ctx('ADMIN'), { language: 'fr', brandKey: 'nope' })
      ).rejects.toThrow(/Unknown brand "nope".*acme/)
      expect(settings.setBrandLanguages).not.toHaveBeenCalled()
    })

    it('reports a list that changed in the meantime in English', async () => {
      const { service, settings } = setup()
      settings.setProjectLanguages.mockRejectedValue(
        new ConflictException('Die Sprachliste wurde inzwischen geändert')
      )
      await expect(
        service.addLanguage(ctx('ADMIN'), { language: 'fr' })
      ).rejects.toThrow(
        new McpToolError(
          'The language list was changed in the meantime. Nothing was written; call get_project and try again.'
        )
      )
    })

    it('maps the language limit of the service to a tool error', async () => {
      const { service, settings } = setup()
      settings.setProjectLanguages.mockRejectedValue(
        new BadRequestException('At most 100 languages are allowed')
      )
      await expect(
        service.addLanguage(ctx('ADMIN'), { language: 'fr' })
      ).rejects.toThrow(new McpToolError('At most 100 languages are allowed'))
    })
  })

  describe('audit attribution', () => {
    it('a write tool produces an audit entry with the MCP key', async () => {
      const prisma: any = {
        project: {
          findFirst: jest.fn().mockResolvedValue(project),
          findUnique: jest.fn().mockResolvedValue(project),
        },
        brand: { findMany: jest.fn().mockResolvedValue(brands) },
        translationKey: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockImplementation(async ({ data }: any) => ({
            id: 'new1',
            ...data,
          })),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      }
      const auditLogs = new AuditLogsService(prisma)
      const translations = new TranslationsService(
        prisma,
        { recordChange: jest.fn().mockResolvedValue(undefined) } as any,
        auditLogs
      )
      const service = new McpToolsService(
        prisma,
        translations,
        { isEnabled: () => false } as any,
        {} as any,
        new McpAiRateLimiter(),
        {} as any
      )
      const c = ctx()

      await runWithActor(
        { apiKeyId: c.apiKeyId, apiKeyName: c.apiKeyName },
        () => service.createKey(c, { key: 'home.title' })
      )

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
      expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'translation.key_created',
        userId: 'u1',
        apiKeyId: 'k1',
        apiKeyName: 'Claude',
      })
    })
  })
})
