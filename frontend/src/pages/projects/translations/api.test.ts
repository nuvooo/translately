import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@/lib/axios', () => ({ default: http }))

import {
  addNamespace,
  applyAiTranslations,
  applyImport,
  createKey,
  deleteKey,
  exportFile,
  fetchAiStatus,
  fetchTable,
  linkValue,
  previewImport,
  previewMissingTranslations,
  removeNamespace,
  setBrandLanguages,
  setProjectLanguages,
  setValue,
  suggestTranslations,
  unlinkValue,
  updateKey,
} from './api'

const target = { language: 'de' }
const content = { greeting: { hello: 'Hallo' } }

describe('translations api', () => {
  beforeEach(() => {
    for (const fn of Object.values(http)) fn.mockReset()
  })

  describe('fetchTable', () => {
    it('sends no params when nothing is set (no environmentId, no brandId)', async () => {
      const table = {
        languages: [],
        namespaces: [],
        rows: [],
        total: 0,
        page: 1,
        pageSize: 50,
      }
      http.get.mockResolvedValue({ data: table })
      await expect(fetchTable('p1', {})).resolves.toBe(table)
      expect(http.get).toHaveBeenCalledWith('/projects/p1/translations', {
        params: {},
      })
    })

    it('omits undefined, empty and false fields, keeps set ones', async () => {
      http.get.mockResolvedValue({ data: {} })
      await fetchTable('p1', {
        namespace: '',
        search: '',
        missingOnly: false,
        page: undefined,
      })
      expect(http.get).toHaveBeenLastCalledWith('/projects/p1/translations', {
        params: {},
      })

      await fetchTable('p1', {
        namespace: 'common',
        search: 'hel',
        missingOnly: true,
        page: 2,
        pageSize: 25,
      })
      expect(http.get).toHaveBeenLastCalledWith('/projects/p1/translations', {
        params: {
          namespace: 'common',
          search: 'hel',
          missingOnly: true,
          page: 2,
          pageSize: 25,
        },
      })
      for (const [, config] of http.get.mock.calls) {
        expect(config.params).not.toHaveProperty('environmentId')
        expect(config.params).not.toHaveProperty('brandId')
      }
    })
  })

  it('fetchAiStatus gets the instance status', async () => {
    http.get.mockResolvedValue({ data: { enabled: true } })
    await expect(fetchAiStatus()).resolves.toEqual({ enabled: true })
    expect(http.get).toHaveBeenCalledWith('/ai-translation/status')
  })

  it('suggestTranslations posts the body to the project suggest route', async () => {
    const data = {
      suggestions: [{ keyId: 'k1', value: 'Hi', placeholderMismatch: false }],
      skipped: [],
    }
    http.post.mockResolvedValue({ data })
    const body = {
      sourceLanguage: 'de',
      targetLanguage: 'en',
      keyIds: ['k1'],
      brandId: 'b1',
    }
    await expect(suggestTranslations('p 1', body)).resolves.toBe(data)
    expect(http.post).toHaveBeenCalledWith(
      '/projects/p%201/translations/ai/suggest',
      body
    )
  })

  it('previewMissingTranslations posts the body to the preview-missing route', async () => {
    const data = { languages: [] }
    http.post.mockResolvedValue({ data })
    const body = {
      namespace: 'common',
      sourceLanguage: 'de',
      targetLanguages: ['en'],
      limit: 50,
    }
    await expect(previewMissingTranslations('p 1', body)).resolves.toBe(data)
    expect(http.post).toHaveBeenCalledWith(
      '/projects/p%201/translations/ai/preview-missing',
      body
    )
  })

  it('applyAiTranslations posts the body to the apply route', async () => {
    const data = { written: 2, skippedExisting: 1 }
    http.post.mockResolvedValue({ data })
    const body = {
      targetLanguage: 'en',
      values: [{ keyId: 'k1', value: 'Hi' }],
    }
    await expect(applyAiTranslations('p 1', body)).resolves.toBe(data)
    expect(http.post).toHaveBeenCalledWith(
      '/projects/p%201/translations/ai/apply',
      body
    )
  })

  it('createKey posts and unwraps res.data.key', async () => {
    const key = { id: 'k1', namespace: 'common', key: 'a.b' }
    http.post.mockResolvedValue({ data: { key } })
    const body = { namespace: 'common', key: 'a.b', description: 'd' }
    await expect(createKey('p1', body)).resolves.toBe(key)
    expect(http.post).toHaveBeenCalledWith(
      '/projects/p1/translation-keys',
      body
    )
  })

  it('updateKey patches and unwraps res.data.key', async () => {
    const key = { id: 'k1', namespace: 'common', key: 'a.c' }
    http.patch.mockResolvedValue({ data: { key } })
    await expect(
      updateKey('k1', { key: 'a.c', description: null })
    ).resolves.toBe(key)
    expect(http.patch).toHaveBeenCalledWith('/translation-keys/k1', {
      key: 'a.c',
      description: null,
    })
  })

  it('deleteKey deletes and resolves to undefined', async () => {
    http.delete.mockResolvedValue({ data: { success: true } })
    await expect(deleteKey('k1')).resolves.toBeUndefined()
    expect(http.delete).toHaveBeenCalledWith('/translation-keys/k1')
  })

  it('setValue puts and unwraps res.data.cell', async () => {
    const cell = { value: 'Hallo', inherited: false }
    http.put.mockResolvedValue({ data: { cell } })
    const body = { language: 'de', brandId: 'b1', value: 'Hallo' }
    await expect(setValue('k1', body)).resolves.toBe(cell)
    expect(http.put).toHaveBeenCalledWith('/translation-keys/k1/value', body)
  })

  it('unlinkValue posts { language } to the brand unlink route and unwraps res.data.cell', async () => {
    const cell = { value: 'Hallo', inherited: false }
    http.post.mockResolvedValue({ data: { cell } })
    await expect(unlinkValue('k', 'b', 'de')).resolves.toBe(cell)
    expect(http.post).toHaveBeenCalledWith(
      '/translation-keys/k/brands/b/unlink',
      { language: 'de' }
    )
  })

  it('linkValue posts { language } to the brand link route and unwraps res.data.cell', async () => {
    const cell = { value: 'Hallo', inherited: true }
    http.post.mockResolvedValue({ data: { cell } })
    await expect(linkValue('k', 'b', 'de')).resolves.toBe(cell)
    expect(http.post).toHaveBeenCalledWith(
      '/translation-keys/k/brands/b/link',
      {
        language: 'de',
      }
    )
  })

  it('link routes encode key and brand ids', async () => {
    http.post.mockResolvedValue({ data: { cell: {} } })
    await unlinkValue('a/b', 'c d', 'de')
    await linkValue('a/b', 'c d', 'de')
    expect(http.post).toHaveBeenNthCalledWith(
      1,
      '/translation-keys/a%2Fb/brands/c%20d/unlink',
      { language: 'de' }
    )
    expect(http.post).toHaveBeenNthCalledWith(
      2,
      '/translation-keys/a%2Fb/brands/c%20d/link',
      { language: 'de' }
    )
  })

  it('setProjectLanguages puts { languages } and returns res.data', async () => {
    const data = { languages: ['de', 'en'], removedValues: 0 }
    http.put.mockResolvedValue({ data })
    await expect(setProjectLanguages('p1', ['de', 'en'])).resolves.toBe(data)
    expect(http.put).toHaveBeenCalledWith('/projects/p1/languages', {
      languages: ['de', 'en'],
    })
  })

  it('setBrandLanguages puts { languages } and returns res.data', async () => {
    const data = { languages: ['de'], removedValues: 3 }
    http.put.mockResolvedValue({ data })
    await expect(setBrandLanguages('b1', ['de'])).resolves.toBe(data)
    expect(http.put).toHaveBeenCalledWith('/brands/b1/languages', {
      languages: ['de'],
    })
  })

  it('setProjectLanguages sends the expected list when given', async () => {
    http.put.mockResolvedValue({
      data: { languages: ['de'], removedValues: 1 },
    })
    await setProjectLanguages('p1', ['de'], ['de', 'en'])
    expect(http.put).toHaveBeenCalledWith('/projects/p1/languages', {
      languages: ['de'],
      expected: ['de', 'en'],
    })
  })

  it('setBrandLanguages sends the expected list when given (also empty)', async () => {
    http.put.mockResolvedValue({
      data: { languages: ['de'], removedValues: 0 },
    })
    await setBrandLanguages('b1', ['de'], [])
    expect(http.put).toHaveBeenCalledWith('/brands/b1/languages', {
      languages: ['de'],
      expected: [],
    })
  })

  it('addNamespace posts { namespace } and returns res.data', async () => {
    const data = { namespaces: ['common', 'auth'] }
    http.post.mockResolvedValue({ data })
    await expect(addNamespace('p1', 'auth')).resolves.toBe(data)
    expect(http.post).toHaveBeenCalledWith('/projects/p1/namespaces', {
      namespace: 'auth',
    })
  })

  it('removeNamespace deletes with an encoded path and returns res.data', async () => {
    const data = { namespaces: ['common'], removedKeys: 4 }
    http.delete.mockResolvedValue({ data })
    await expect(removeNamespace('p1', 'a b/c')).resolves.toBe(data)
    expect(http.delete).toHaveBeenCalledWith(
      '/projects/p1/namespaces/a%20b%2Fc'
    )
  })

  describe('import', () => {
    const preview = {
      added: ['a'],
      changed: [],
      unchanged: [],
      newKeys: ['a'],
      skipped: [],
    }

    it('previewImport posts target fields flat next to content', async () => {
      http.post.mockResolvedValue({ data: preview })
      await expect(previewImport('p1', target, content)).resolves.toBe(preview)
      expect(http.post).toHaveBeenCalledWith(
        '/projects/p1/translations/import/preview',
        { language: 'de', content }
      )
    })

    it('applyImport includes namespace and brandId when set', async () => {
      http.post.mockResolvedValue({ data: preview })
      await expect(
        applyImport(
          'p1',
          { ...target, namespace: 'common', brandId: 'b1' },
          content
        )
      ).resolves.toBe(preview)
      expect(http.post).toHaveBeenCalledWith(
        '/projects/p1/translations/import',
        {
          language: 'de',
          namespace: 'common',
          brandId: 'b1',
          content,
        }
      )
    })
  })

  describe('exportFile', () => {
    it('requests a blob with only the set params', async () => {
      const blob = new Blob(['{}'])
      http.get.mockResolvedValue({ data: blob })
      await expect(exportFile('p1', target)).resolves.toBe(blob)
      expect(http.get).toHaveBeenCalledWith(
        '/projects/p1/translations/export',
        {
          params: { language: 'de' },
          responseType: 'blob',
        }
      )
    })

    it('adds namespace and brandId when set', async () => {
      http.get.mockResolvedValue({ data: new Blob() })
      await exportFile('p1', { ...target, namespace: 'common', brandId: 'b1' })
      expect(http.get).toHaveBeenCalledWith(
        '/projects/p1/translations/export',
        {
          params: {
            language: 'de',
            namespace: 'common',
            brandId: 'b1',
          },
          responseType: 'blob',
        }
      )
    })
  })
})
