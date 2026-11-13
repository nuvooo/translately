import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { TableCell, TableRow, TranslationTable } from './types'

const http = vi.hoisted(() => ({ get: vi.fn() }))
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
const translationsApi = vi.hoisted(() => ({
  fetchTable: vi.fn(),
  createKey: vi.fn(),
  updateKey: vi.fn(),
  deleteKey: vi.fn(),
  setKeyLocked: vi.fn(),
  setValue: vi.fn(),
  unlinkValue: vi.fn(),
  linkValue: vi.fn(),
}))

vi.mock('@/lib/axios', () => ({ default: http }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/workspace', () => ({
  refreshWorkspace: vi.fn(() => Promise.resolve()),
  useWorkspace: () => ({
    projects: [],
    organizations: [],
    isLoading: false,
    error: null,
  }),
}))
vi.mock('./api', () => translationsApi)

import { scopeOf, withCell } from './translationsState'
import { cellKey, useTranslations } from './useTranslations'

interface ProjectFixture {
  id: string
  key: string
  name: string
  type: 'SINGLE' | 'MULTI'
  languages: string[]
  namespaces: string[]
}

const server = {
  project: null as ProjectFixture | null,
  brands: [] as unknown[],
  projectError: null as unknown,
}

const ALPHA = {
  id: 'b1',
  key: 'alpha',
  name: 'Alpha',
  description: null,
  locked: false,
  languages: ['de'],
}

const httpError = (status: number, message = 'boom') => ({
  isAxiosError: true,
  message: 'Request failed',
  response: { status, data: { message } },
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const cell = (value: string | null, inherited = false): TableCell => ({
  value,
  inherited,
})

function row(
  keyId: string,
  de: string | null,
  en: string | null,
  overrides: Record<string, Record<string, string>> = {}
): TableRow {
  return {
    keyId,
    key: `key.${keyId}`,
    description: null,
    locked: false,
    values: { de: cell(de), en: cell(en) },
    overrides,
  }
}

function table(rows: TableRow[], page = 1): TranslationTable {
  return {
    languages: ['de', 'en'],
    namespaces: ['common', 'translation'],
    rows,
    total: rows.length,
    page,
    pageSize: 50,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  server.project = {
    id: 'p1',
    key: 'shop',
    name: 'Shop',
    type: 'MULTI',
    languages: ['de', 'en'],
    namespaces: ['common', 'translation'],
  }
  server.brands = [ALPHA]
  server.projectError = null
  http.get.mockImplementation((url: string) => {
    if (url.startsWith('/projects/')) {
      if (server.projectError) return Promise.reject(server.projectError)
      return Promise.resolve({ data: { project: server.project } })
    }
    if (url.startsWith('/brands/project/'))
      return Promise.resolve({ data: { brands: server.brands } })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
  translationsApi.fetchTable.mockResolvedValue(
    table([row('k1', 'Hallo', 'Hello'), row('k2', null, 'Bye')])
  )
})

afterEach(() => {
  vi.useRealTimers()
})

const rowsOf = (result: { current: { table: TranslationTable | null } }) =>
  result.current.table?.rows ?? []

async function renderLoaded(projectId: string | null = 'p1') {
  const hook = renderHook(({ id }) => useTranslations(id), {
    initialProps: { id: projectId },
  })
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
  return hook
}

describe('cellKey', () => {
  it('joins key id, language and scope (default without a brand)', () => {
    expect(cellKey('k1', 'de')).toBe('k1:de:default')
    expect(cellKey('k1', 'de', null)).toBe('k1:de:default')
    expect(cellKey('k1', 'de', 'b1')).toBe('k1:de:b1')
  })
})

describe('initial load', () => {
  it('starts on namespace translation, page 1, and loads the table once the project is there', async () => {
    const { result } = await renderLoaded()

    expect(result.current.project).toEqual({
      id: 'p1',
      key: 'shop',
      type: 'MULTI',
      languages: ['de', 'en'],
      namespaces: ['common', 'translation'],
    })
    expect(result.current).not.toHaveProperty('environments')
    expect(result.current.brands).toEqual([
      { id: 'b1', key: 'alpha', name: 'Alpha', languages: ['de'] },
    ])
    expect(result.current.selection).toEqual({
      namespace: 'translation',
      search: '',
      missingOnly: false,
      page: 1,
    })
    expect(http.get).toHaveBeenCalledWith('/projects/p1')
    expect(http.get).toHaveBeenCalledWith('/brands/project/p1')
    expect(http.get).toHaveBeenCalledTimes(2)
    expect(translationsApi.fetchTable).toHaveBeenCalledTimes(1)
    expect(translationsApi.fetchTable).toHaveBeenCalledWith('p1', {
      namespace: 'translation',
      page: 1,
    })
    expect(result.current.table?.rows).toHaveLength(2)
    expect(result.current.error).toBeNull()
  })

  it('uses the first namespace when translation does not exist', async () => {
    server.project = {
      ...(server.project as ProjectFixture),
      namespaces: ['app'],
    }
    const { result } = await renderLoaded()
    expect(result.current.selection.namespace).toBe('app')
  })

  it('does not load brands for a SINGLE project', async () => {
    server.project = { ...(server.project as ProjectFixture), type: 'SINGLE' }
    const { result } = await renderLoaded()

    expect(result.current.brands).toEqual([])
    expect(http.get).not.toHaveBeenCalledWith('/brands/project/p1')
  })

  it('reports not-found for a 404 on the project and requests no table', async () => {
    server.projectError = httpError(404)
    const { result } = await renderLoaded()
    expect(result.current.error).toBe('not-found')
    expect(result.current.project).toBeNull()
    expect(translationsApi.fetchTable).not.toHaveBeenCalled()
  })

  it('reports failed for other errors and toasts a 403', async () => {
    server.projectError = httpError(403)
    const { result } = await renderLoaded()
    expect(result.current.error).toBe('failed')
    expect(toast.error).toHaveBeenCalledWith(i18n.t('permissions.forbidden'))
  })

  it('loads nothing without a project id', async () => {
    const { result } = await renderLoaded(null)
    expect(result.current.project).toBeNull()
    expect(http.get).not.toHaveBeenCalled()
    expect(translationsApi.fetchTable).not.toHaveBeenCalled()
  })

  it('drops the response for a previous project', async () => {
    const first = deferred<unknown>()
    http.get.mockImplementationOnce(() => first.promise)
    const hook = renderHook(({ id }) => useTranslations(id), {
      initialProps: { id: 'p0' as string | null },
    })
    hook.rerender({ id: 'p1' })
    await waitFor(() => expect(hook.result.current.project?.id).toBe('p1'))
    await act(async () => {
      first.resolve({
        data: { project: { ...server.project, id: 'p0', key: 'old' } },
      })
    })
    expect(hook.result.current.project?.key).toBe('shop')
    expect(hook.result.current.isLoading).toBe(false)
  })
})

describe('select', () => {
  it('select({ namespace }) reloads with page 1', async () => {
    const { result } = await renderLoaded()
    act(() => result.current.select({ page: 3 }))
    await waitFor(() =>
      expect(translationsApi.fetchTable).toHaveBeenLastCalledWith('p1', {
        namespace: 'translation',
        page: 3,
      })
    )

    act(() => result.current.select({ namespace: 'common' }))

    expect(result.current.selection.page).toBe(1)
    expect(result.current.selection.namespace).toBe('common')
    expect(translationsApi.fetchTable).toHaveBeenLastCalledWith('p1', {
      namespace: 'common',
      page: 1,
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  it('sends missing-only only when set', async () => {
    const { result } = await renderLoaded()
    act(() => result.current.select({ missingOnly: true }))

    expect(translationsApi.fetchTable).toHaveBeenLastCalledWith('p1', {
      namespace: 'translation',
      missingOnly: true,
      page: 1,
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  it('drops a stale response that resolves after the newer one', async () => {
    const { result } = await renderLoaded()
    const first = deferred<TranslationTable>()
    const second = deferred<TranslationTable>()
    translationsApi.fetchTable
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    act(() => result.current.select({ namespace: 'common' }))
    act(() => result.current.select({ missingOnly: true }))
    expect(result.current.isLoading).toBe(true)

    await act(async () => second.resolve(table([row('new', 'Neu', 'New')])))
    expect(result.current.isLoading).toBe(false)
    await act(async () => first.resolve(table([row('old', 'Alt', 'Old')])))

    expect(result.current.table?.rows.map((r) => r.keyId)).toEqual(['new'])
    expect(result.current.isLoading).toBe(false)
  })

  it('ignores the error of a stale request', async () => {
    const { result } = await renderLoaded()
    const first = deferred<TranslationTable>()
    translationsApi.fetchTable.mockReturnValueOnce(first.promise)

    act(() => result.current.select({ namespace: 'common' }))
    act(() => result.current.select({ missingOnly: true }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => first.reject(httpError(500)))

    expect(result.current.error).toBeNull()
    expect(result.current.table).not.toBeNull()
  })

  it('reports failed when the table cannot be loaded', async () => {
    translationsApi.fetchTable.mockRejectedValueOnce(httpError(500))
    const { result } = await renderLoaded()
    expect(result.current.error).toBe('failed')
  })

  describe('search debounce', () => {
    it('requests only after 300 ms, once, with the trimmed search', async () => {
      const { result } = await renderLoaded()
      vi.useFakeTimers()

      act(() => result.current.select({ search: ' hel' }))
      act(() => result.current.select({ search: ' hello ' }))
      expect(result.current.selection.search).toBe(' hello ')
      act(() => vi.advanceTimersByTime(299))
      expect(translationsApi.fetchTable).toHaveBeenCalledTimes(1)

      act(() => vi.advanceTimersByTime(1))
      expect(translationsApi.fetchTable).toHaveBeenCalledTimes(2)
      expect(translationsApi.fetchTable).toHaveBeenLastCalledWith('p1', {
        namespace: 'translation',
        search: 'hello',
        page: 1,
      })
      await act(async () => {})
      act(() => vi.advanceTimersByTime(1000))
      expect(translationsApi.fetchTable).toHaveBeenCalledTimes(2)
    })

    it('a non-search change during the window sends one request with the latest search', async () => {
      const { result } = await renderLoaded()
      vi.useFakeTimers()

      act(() => result.current.select({ search: 'abc' }))
      act(() => result.current.select({ missingOnly: true }))
      expect(translationsApi.fetchTable).toHaveBeenCalledTimes(2)
      expect(translationsApi.fetchTable).toHaveBeenLastCalledWith('p1', {
        namespace: 'translation',
        search: 'abc',
        missingOnly: true,
        page: 1,
      })
      await act(async () => {})
      act(() => vi.advanceTimersByTime(1000))
      expect(translationsApi.fetchTable).toHaveBeenCalledTimes(2)
    })

    it('unmounting cancels a pending search', async () => {
      const { result, unmount } = await renderLoaded()
      vi.useFakeTimers()

      act(() => result.current.select({ search: 'abc' }))
      unmount()
      vi.advanceTimersByTime(1000)
      expect(translationsApi.fetchTable).toHaveBeenCalledTimes(1)
    })
  })
})

describe('saveValue', () => {
  it('shows the value at once, marks the cell busy and takes the server cell', async () => {
    const { result } = await renderLoaded()
    const request = deferred<TableCell>()
    translationsApi.setValue.mockReturnValueOnce(request.promise)
    const target = rowsOf(result)[0]
    const untouched = rowsOf(result)[1]

    let saved: Promise<boolean> = Promise.resolve(false)
    act(() => {
      saved = result.current.saveValue(target, 'de', 'Hallo!')
    })
    expect(rowsOf(result)[0].values.de).toEqual(cell('Hallo!'))
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(true)
    expect(result.current.isBusy(cellKey('k1', 'en'))).toBe(false)

    await act(async () => request.resolve(cell('Hallo! (server)')))

    expect(await saved).toBe(true)
    expect(translationsApi.setValue).toHaveBeenCalledWith('k1', {
      language: 'de',
      value: 'Hallo!',
    })
    const rows = rowsOf(result)
    expect(rows[0].values).toEqual({
      de: cell('Hallo! (server)'),
      en: cell('Hello'),
    })
    expect(rows[1]).toBe(untouched)
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)
    expect(translationsApi.fetchTable).toHaveBeenCalledTimes(1)
  })

  it('on failure toasts, restores the cell, clears busy and returns false', async () => {
    const { result } = await renderLoaded()
    translationsApi.setValue.mockRejectedValueOnce(httpError(500))

    let saved = true
    await act(async () => {
      saved = await result.current.saveValue(rowsOf(result)[0], 'de', 'Kaputt')
    })

    expect(saved).toBe(false)
    expect(rowsOf(result)[0].values.de).toEqual(cell('Hallo'))
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      i18n.t('translations.toast.save-failed')
    )
  })

  it('a 403 toasts "no permission"', async () => {
    const { result } = await renderLoaded()
    translationsApi.setValue.mockRejectedValueOnce(httpError(403))

    await act(async () => {
      await result.current.saveValue(rowsOf(result)[0], 'de', 'x')
    })

    expect(toast.error).toHaveBeenCalledWith(i18n.t('permissions.forbidden'))
  })

  it('concurrent saves on different cells keep both results', async () => {
    const { result } = await renderLoaded()
    const a = deferred<TableCell>()
    const b = deferred<TableCell>()
    translationsApi.setValue
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise)
    const [r1, r2] = rowsOf(result)

    act(() => {
      result.current.saveValue(r1, 'de', 'A')
      result.current.saveValue(r2, 'en', 'B')
    })
    await act(async () => b.resolve(cell('B!')))
    await act(async () => a.resolve(cell('A!')))

    const rows = rowsOf(result)
    expect(rows[0].values.de).toEqual(cell('A!'))
    expect(rows[1].values.en).toEqual(cell('B!'))
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)
    expect(result.current.isBusy(cellKey('k2', 'en'))).toBe(false)
  })

  it('a save settling after a namespace switch does not touch the new table', async () => {
    const { result } = await renderLoaded()
    const ok = deferred<TableCell>()
    const bad = deferred<TableCell>()
    translationsApi.setValue
      .mockReturnValueOnce(ok.promise)
      .mockReturnValueOnce(bad.promise)
    const [r1] = rowsOf(result)

    let okSaved: Promise<boolean> = Promise.resolve(false)
    let badSaved: Promise<boolean> = Promise.resolve(true)
    act(() => {
      okSaved = result.current.saveValue(r1, 'de', 'Dev')
      badSaved = result.current.saveValue(r1, 'en', 'Dev')
    })
    translationsApi.fetchTable.mockResolvedValueOnce(
      table([row('k1', 'Common', 'Common')])
    )
    act(() => result.current.select({ namespace: 'common' }))
    await waitFor(() =>
      expect(rowsOf(result)[0].values.de.value).toBe('Common')
    )

    await act(async () => ok.resolve(cell('Dev (server)')))
    await act(async () => bad.reject(httpError(500)))

    expect(await okSaved).toBe(true)
    expect(await badSaved).toBe(false)
    expect(rowsOf(result)[0].values).toEqual({
      de: cell('Common'),
      en: cell('Common'),
    })
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)
    expect(result.current.isBusy(cellKey('k1', 'en'))).toBe(false)
  })

  it('saving an empty text takes the server cell as-is', async () => {
    const { result } = await renderLoaded()
    translationsApi.setValue.mockResolvedValueOnce(cell(null))

    await act(async () => {
      await result.current.saveValue(rowsOf(result)[0], 'de', '')
    })

    expect(rowsOf(result)[0].values.de).toEqual(cell(null))
  })

  it('a standard save changes values only and leaves the overrides untouched', async () => {
    translationsApi.fetchTable.mockResolvedValue(
      table([row('k1', 'Hallo', 'Hello', { b1: { en: 'Own' } })])
    )
    const { result } = await renderLoaded()
    const overrides = rowsOf(result)[0].overrides
    translationsApi.setValue.mockResolvedValueOnce(cell('Neu'))

    await act(async () => {
      await result.current.saveValue(rowsOf(result)[0], 'de', 'Neu')
    })

    expect(rowsOf(result)[0].values.de).toEqual(cell('Neu'))
    expect(rowsOf(result)[0].overrides).toBe(overrides)
    expect(rowsOf(result)[0].overrides).toEqual({ b1: { en: 'Own' } })
  })
})

describe('brand overrides', () => {
  const withOwn = () =>
    translationsApi.fetchTable.mockResolvedValue(
      table([
        row('k1', 'Hallo', 'Hello', { b1: { de: 'Eigen' } }),
        row('k2', null, 'Bye'),
      ])
    )

  it('saveValue with a brand sends the brand and stores the override', async () => {
    const { result } = await renderLoaded()
    const request = deferred<TableCell>()
    translationsApi.setValue.mockReturnValueOnce(request.promise)
    const values = rowsOf(result)[0].values

    let saved: Promise<boolean> = Promise.resolve(false)
    act(() => {
      saved = result.current.saveValue(rowsOf(result)[0], 'de', 'Neu', 'b1')
    })
    expect(rowsOf(result)[0].overrides.b1.de).toBe('Neu')

    await act(async () => request.resolve(cell('Neu')))

    expect(await saved).toBe(true)
    expect(translationsApi.setValue).toHaveBeenCalledWith('k1', {
      language: 'de',
      brandId: 'b1',
      value: 'Neu',
    })
    expect(rowsOf(result)[0].overrides.b1.de).toBe('Neu')
    expect(rowsOf(result)[0].values).toBe(values)
  })

  it('saveValue with a brand and an empty text removes the override', async () => {
    withOwn()
    const { result } = await renderLoaded()
    const request = deferred<TableCell>()
    translationsApi.setValue.mockReturnValueOnce(request.promise)

    act(() => {
      result.current.saveValue(rowsOf(result)[0], 'de', '', 'b1')
    })
    expect(rowsOf(result)[0].overrides).toEqual({})

    await act(async () => request.resolve(cell('Hallo', true)))

    expect(translationsApi.setValue).toHaveBeenCalledWith('k1', {
      language: 'de',
      brandId: 'b1',
      value: '',
    })
    expect(rowsOf(result)[0].overrides).toEqual({})
  })

  it('a brand save answered with an empty cell removes the override', async () => {
    withOwn()
    const { result } = await renderLoaded()
    translationsApi.setValue.mockResolvedValueOnce(cell(null))

    await act(async () => {
      await result.current.saveValue(rowsOf(result)[0], 'de', '', 'b1')
    })

    expect(rowsOf(result)[0].overrides).toEqual({})
  })

  it('a failed brand save restores the previous override', async () => {
    withOwn()
    const { result } = await renderLoaded()
    translationsApi.setValue.mockRejectedValueOnce(httpError(500))

    let saved = true
    await act(async () => {
      saved = await result.current.saveValue(
        rowsOf(result)[0],
        'de',
        'Kaputt',
        'b1'
      )
    })

    expect(saved).toBe(false)
    expect(rowsOf(result)[0].overrides).toEqual({ b1: { de: 'Eigen' } })
    expect(toast.error).toHaveBeenCalledWith(
      i18n.t('translations.toast.save-failed')
    )
  })

  it('relink calls linkValue and removes the override', async () => {
    withOwn()
    const { result } = await renderLoaded()
    translationsApi.linkValue.mockResolvedValueOnce(cell('Hallo', true))

    let linked = false
    await act(async () => {
      linked = await result.current.relink(rowsOf(result)[0], 'de', 'b1')
    })

    expect(linked).toBe(true)
    expect(translationsApi.linkValue).toHaveBeenCalledWith('k1', 'b1', 'de')
    expect(translationsApi.setValue).not.toHaveBeenCalled()
    expect(rowsOf(result)[0].overrides).toEqual({})
  })

  it('unlink with a standard text calls unlinkValue and stores the standard text as override', async () => {
    const { result } = await renderLoaded()
    const request = deferred<TableCell>()
    translationsApi.unlinkValue.mockReturnValueOnce(request.promise)

    let unlinked: Promise<boolean> = Promise.resolve(false)
    act(() => {
      unlinked = result.current.unlink(rowsOf(result)[0], 'de', 'b1')
    })
    expect(rowsOf(result)[0].overrides).toEqual({ b1: { de: 'Hallo' } })

    await act(async () => request.resolve(cell('Hallo')))

    expect(await unlinked).toBe(true)
    expect(translationsApi.unlinkValue).toHaveBeenCalledWith('k1', 'b1', 'de')
    expect(rowsOf(result)[0].overrides).toEqual({ b1: { de: 'Hallo' } })
  })

  it('unlink without a standard text sends no request and returns true', async () => {
    const { result } = await renderLoaded()
    const before = result.current.table

    let unlinked = false
    await act(async () => {
      unlinked = await result.current.unlink(rowsOf(result)[1], 'de', 'b1')
    })

    expect(unlinked).toBe(true)
    expect(translationsApi.unlinkValue).not.toHaveBeenCalled()
    expect(result.current.table).toBe(before)
    expect(result.current.isBusy(cellKey('k2', 'de', 'b1'))).toBe(false)
  })

  it('a failing unlink removes the override again, toasts and returns false', async () => {
    const { result } = await renderLoaded()
    translationsApi.unlinkValue.mockRejectedValueOnce(httpError(500))

    let unlinked = true
    await act(async () => {
      unlinked = await result.current.unlink(rowsOf(result)[0], 'de', 'b1')
    })

    expect(unlinked).toBe(false)
    expect(rowsOf(result)[0].overrides).toEqual({})
    expect(toast.error).toHaveBeenCalledWith(
      i18n.t('translations.toast.save-failed')
    )
    expect(result.current.isBusy(cellKey('k1', 'de', 'b1'))).toBe(false)
  })

  it('unlink then relink of one cell, answered in reverse order, ends without override', async () => {
    const { result } = await renderLoaded()
    const unlinkRequest = deferred<TableCell>()
    const linkRequest = deferred<TableCell>()
    translationsApi.unlinkValue.mockReturnValueOnce(unlinkRequest.promise)
    translationsApi.linkValue.mockReturnValueOnce(linkRequest.promise)

    act(() => {
      result.current.unlink(rowsOf(result)[0], 'de', 'b1')
    })
    act(() => {
      result.current.relink(rowsOf(result)[0], 'de', 'b1')
    })
    expect(rowsOf(result)[0].overrides).toEqual({})

    await act(async () => linkRequest.resolve(cell('Hallo', true)))
    expect(rowsOf(result)[0].overrides).toEqual({})
    expect(result.current.isBusy(cellKey('k1', 'de', 'b1'))).toBe(true)

    await act(async () => unlinkRequest.resolve(cell('Hallo')))
    expect(rowsOf(result)[0].overrides).toEqual({})
    expect(result.current.isBusy(cellKey('k1', 'de', 'b1'))).toBe(false)
  })

  it('marks only the brand cell busy while its request runs', async () => {
    const { result } = await renderLoaded()
    const request = deferred<TableCell>()
    translationsApi.setValue.mockReturnValueOnce(request.promise)

    act(() => {
      result.current.saveValue(rowsOf(result)[0], 'de', 'Neu', 'b1')
    })
    expect(result.current.isBusy(cellKey('k1', 'de', 'b1'))).toBe(true)
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)

    await act(async () => request.resolve(cell('Neu')))
    expect(result.current.isBusy(cellKey('k1', 'de', 'b1'))).toBe(false)
  })

  it('a standard save and a brand save of the same language are independent', async () => {
    const { result } = await renderLoaded()
    const standard = deferred<TableCell>()
    const brand = deferred<TableCell>()
    translationsApi.setValue
      .mockReturnValueOnce(standard.promise)
      .mockReturnValueOnce(brand.promise)

    act(() => {
      result.current.saveValue(rowsOf(result)[0], 'de', 'Std')
      result.current.saveValue(rowsOf(result)[0], 'de', 'Own', 'b1')
    })
    await act(async () => brand.resolve(cell('Own')))
    await act(async () => standard.resolve(cell('Std')))

    expect(rowsOf(result)[0].values.de).toEqual(cell('Std'))
    expect(rowsOf(result)[0].overrides).toEqual({ b1: { de: 'Own' } })
  })
})

describe('keys', () => {
  it('createKey creates in the selected namespace and reloads', async () => {
    const { result } = await renderLoaded()
    act(() => result.current.select({ namespace: 'common' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    translationsApi.createKey.mockResolvedValueOnce({ id: 'k3' })
    translationsApi.fetchTable.mockClear()

    let created = false
    await act(async () => {
      created = await result.current.createKey('home.title', 'Headline')
    })

    expect(created).toBe(true)
    expect(translationsApi.createKey).toHaveBeenCalledWith('p1', {
      namespace: 'common',
      key: 'home.title',
      description: 'Headline',
    })
    expect(translationsApi.fetchTable).toHaveBeenCalledWith('p1', {
      namespace: 'common',
      page: 1,
    })
  })

  it('createKey shows a locale text plus the short server detail on 409', async () => {
    const { result } = await renderLoaded()
    translationsApi.createKey.mockRejectedValueOnce(
      httpError(409, 'Key "a" conflicts with "a.b"')
    )

    let created = true
    await act(async () => {
      created = await result.current.createKey('a')
    })

    expect(created).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      'A key with this name already exists or collides with an existing key. (Key "a" conflicts with "a.b")'
    )
    expect(translationsApi.fetchTable).toHaveBeenCalledTimes(1)
  })

  it('createKey on 409 leaves out a long or missing server detail', async () => {
    const { result } = await renderLoaded()
    translationsApi.createKey.mockRejectedValueOnce(
      httpError(409, `Key "${'x'.repeat(300)}" already exists`)
    )
    await act(async () => {
      await result.current.createKey('a')
    })
    translationsApi.createKey.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed',
      response: { status: 409, data: {} },
    })
    await act(async () => {
      await result.current.createKey('a')
    })

    const text =
      'A key with this name already exists or collides with an existing key.'
    expect(toast.error).toHaveBeenNthCalledWith(1, text)
    expect(toast.error).toHaveBeenNthCalledWith(2, text)
  })

  it('createKey toasts generically on other errors', async () => {
    const { result } = await renderLoaded()
    translationsApi.createKey.mockRejectedValueOnce(httpError(500))

    let created = true
    await act(async () => {
      created = await result.current.createKey('a')
    })

    expect(created).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      i18n.t('translations.toast.key-failed')
    )
  })

  it('renameKey updates the key and reloads; 409 shows the locale text', async () => {
    const { result } = await renderLoaded()
    const target = rowsOf(result)[0]
    translationsApi.updateKey.mockResolvedValueOnce({ id: 'k1' })

    let renamed = false
    await act(async () => {
      renamed = await result.current.renameKey(target, 'renamed')
    })
    expect(renamed).toBe(true)
    expect(translationsApi.updateKey).toHaveBeenCalledWith('k1', {
      key: 'renamed',
    })
    expect(translationsApi.fetchTable).toHaveBeenCalledTimes(2)

    translationsApi.updateKey.mockRejectedValueOnce(httpError(409, 'exists'))
    await act(async () => {
      renamed = await result.current.renameKey(target, 'taken')
    })
    expect(renamed).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      'A key with this name already exists or collides with an existing key. (exists)'
    )
  })

  it('deleteKey reloads the table', async () => {
    const { result } = await renderLoaded()
    translationsApi.deleteKey.mockResolvedValueOnce(undefined)

    let deleted = false
    await act(async () => {
      deleted = await result.current.deleteKey(rowsOf(result)[0])
    })

    expect(deleted).toBe(true)
    expect(translationsApi.deleteKey).toHaveBeenCalledWith('k1')
    expect(translationsApi.fetchTable).toHaveBeenCalledTimes(2)
  })

  it('deleting the only row of a later page goes back one page', async () => {
    const { result } = await renderLoaded()
    translationsApi.fetchTable.mockResolvedValueOnce(
      table([row('k9', 'x', 'y')], 3)
    )
    act(() => result.current.select({ page: 3 }))
    await waitFor(() => expect(rowsOf(result)[0].keyId).toBe('k9'))
    translationsApi.deleteKey.mockResolvedValueOnce(undefined)

    await act(async () => {
      await result.current.deleteKey(rowsOf(result)[0])
    })

    expect(result.current.selection.page).toBe(2)
    expect(translationsApi.fetchTable).toHaveBeenLastCalledWith('p1', {
      namespace: 'translation',
      page: 2,
    })
  })

  const lockedError = () => ({
    isAxiosError: true,
    message: 'Request failed',
    response: {
      status: 409,
      data: { message: 'Key "a" is locked', code: 'key_locked' },
    },
  })

  it('setKeyLocked stores the lock and reloads the table', async () => {
    const { result } = await renderLoaded()
    translationsApi.setKeyLocked.mockResolvedValueOnce(undefined)

    let done = false
    await act(async () => {
      done = await result.current.setKeyLocked(rowsOf(result)[0], true)
    })

    expect(done).toBe(true)
    expect(translationsApi.setKeyLocked).toHaveBeenCalledWith('k1', true)
    expect(translationsApi.fetchTable).toHaveBeenCalledTimes(2)
  })

  it('setKeyLocked toasts and returns false on error, without a reload', async () => {
    const { result } = await renderLoaded()
    translationsApi.setKeyLocked.mockRejectedValueOnce(httpError(500))

    let done = true
    await act(async () => {
      done = await result.current.setKeyLocked(rowsOf(result)[0], false)
    })

    expect(done).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      i18n.t('translations.toast.lock-failed')
    )
    expect(translationsApi.fetchTable).toHaveBeenCalledTimes(1)
  })

  it('renameKey of a key locked meanwhile names the lock, not a name conflict', async () => {
    const { result } = await renderLoaded()
    translationsApi.updateKey.mockRejectedValueOnce(lockedError())

    let renamed = true
    await act(async () => {
      renamed = await result.current.renameKey(rowsOf(result)[0], 'renamed')
    })

    expect(renamed).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      i18n.t('translations.toast.key-locked')
    )
  })

  it('deleteKey of a key locked meanwhile names the lock and reloads to show it', async () => {
    const { result } = await renderLoaded()
    translationsApi.deleteKey.mockRejectedValueOnce(lockedError())

    let deleted = true
    await act(async () => {
      deleted = await result.current.deleteKey(rowsOf(result)[0])
    })

    expect(deleted).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      i18n.t('translations.toast.key-locked')
    )
    expect(translationsApi.fetchTable).toHaveBeenCalledTimes(2)
  })

  it('deleteKey toasts and returns false on error', async () => {
    const { result } = await renderLoaded()
    translationsApi.deleteKey.mockRejectedValueOnce(httpError(500))

    let deleted = true
    await act(async () => {
      deleted = await result.current.deleteKey(rowsOf(result)[0])
    })

    expect(deleted).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      i18n.t('translations.toast.delete-failed')
    )
  })
})

describe('reload', () => {
  it('refetches structure and keeps the selection where still valid', async () => {
    const { result } = await renderLoaded()
    act(() => result.current.select({ namespace: 'common' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.select({ page: 2 }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    server.brands = []
    server.project = {
      ...(server.project as ProjectFixture),
      languages: ['de', 'en', 'fr'],
      namespaces: ['translation'],
    }
    http.get.mockClear()
    await act(async () => {
      await result.current.reload()
    })

    expect(http.get).toHaveBeenCalledWith('/projects/p1')
    expect(http.get).toHaveBeenCalledWith('/brands/project/p1')
    expect(result.current.project?.languages).toEqual(['de', 'en', 'fr'])
    expect(result.current.brands).toEqual([])
    expect(result.current.selection).toEqual({
      namespace: 'translation',
      search: '',
      missingOnly: false,
      page: 1,
    })
    expect(translationsApi.fetchTable).toHaveBeenLastCalledWith('p1', {
      namespace: 'translation',
      page: 1,
    })
  })

  it('keeps the page when nothing fell back', async () => {
    const { result } = await renderLoaded()
    act(() => result.current.select({ page: 2 }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.reload()
    })

    expect(result.current.selection.page).toBe(2)
  })
})

describe('fix round 1', () => {
  it('a 404 on the table reports failed, not not-found', async () => {
    translationsApi.fetchTable.mockRejectedValueOnce(httpError(404))
    const { result } = await renderLoaded()
    expect(result.current.error).toBe('failed')
  })

  it('a stale response settling first keeps isLoading and the table', async () => {
    const { result } = await renderLoaded()
    const before = result.current.table
    const first = deferred<TranslationTable>()
    const second = deferred<TranslationTable>()
    translationsApi.fetchTable
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    act(() => result.current.select({ namespace: 'common' }))
    act(() => result.current.select({ missingOnly: true }))
    await act(async () => first.resolve(table([row('old', 'Alt', 'Old')])))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.table).toBe(before)
    expect(result.current.error).toBeNull()

    await act(async () => second.resolve(table([row('new', 'Neu', 'New')])))
    expect(result.current.isLoading).toBe(false)
    expect(rowsOf(result).map((r) => r.keyId)).toEqual(['new'])
  })

  it('a stale error settling first keeps isLoading, table and error', async () => {
    const { result } = await renderLoaded()
    const before = result.current.table
    const first = deferred<TranslationTable>()
    const second = deferred<TranslationTable>()
    translationsApi.fetchTable
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    act(() => result.current.select({ namespace: 'common' }))
    act(() => result.current.select({ missingOnly: true }))
    await act(async () => first.reject(httpError(500)))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.table).toBe(before)
    expect(result.current.error).toBeNull()

    await act(async () => second.resolve(table([row('new', 'Neu', 'New')])))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  describe('overlapping saves of one cell', () => {
    it('the newest save wins and busy lasts until both settle', async () => {
      const { result } = await renderLoaded()
      const a = deferred<TableCell>()
      const b = deferred<TableCell>()
      translationsApi.setValue
        .mockReturnValueOnce(a.promise)
        .mockReturnValueOnce(b.promise)

      let savedA: Promise<boolean> = Promise.resolve(false)
      let savedB: Promise<boolean> = Promise.resolve(false)
      act(() => {
        savedA = result.current.saveValue(rowsOf(result)[0], 'de', 'a')
      })
      act(() => {
        savedB = result.current.saveValue(rowsOf(result)[0], 'de', 'b')
      })
      await act(async () => b.resolve(cell('b!')))
      expect(rowsOf(result)[0].values.de).toEqual(cell('b!'))
      expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(true)

      await act(async () => a.resolve(cell('a!')))
      expect(rowsOf(result)[0].values.de).toEqual(cell('b!'))
      expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)
      expect(await savedA).toBe(true)
      expect(await savedB).toBe(true)
    })

    it('a failing newer save restores the original while the older is pending, then the older server cell', async () => {
      const { result } = await renderLoaded()
      const a = deferred<TableCell>()
      translationsApi.setValue
        .mockReturnValueOnce(a.promise)
        .mockRejectedValueOnce(httpError(500))

      act(() => {
        result.current.saveValue(rowsOf(result)[0], 'de', 'a')
      })
      let savedB = true
      await act(async () => {
        savedB = await result.current.saveValue(rowsOf(result)[0], 'de', 'b')
      })

      expect(savedB).toBe(false)
      expect(rowsOf(result)[0].values.de).toEqual(cell('Hallo'))
      expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(true)

      await act(async () => a.resolve(cell('a!')))
      expect(rowsOf(result)[0].values.de).toEqual(cell('a!'))
      expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)
    })

    it('a failing newer save after the older one resolved restores the older server cell', async () => {
      const { result } = await renderLoaded()
      const a = deferred<TableCell>()
      const b = deferred<TableCell>()
      translationsApi.setValue
        .mockReturnValueOnce(a.promise)
        .mockReturnValueOnce(b.promise)

      act(() => {
        result.current.saveValue(rowsOf(result)[0], 'de', 'a')
      })
      act(() => {
        result.current.saveValue(rowsOf(result)[0], 'de', 'b')
      })
      await act(async () => a.resolve(cell('a!')))
      expect(rowsOf(result)[0].values.de).toEqual(cell('b'))
      expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(true)

      await act(async () => b.reject(httpError(500)))
      expect(rowsOf(result)[0].values.de).toEqual(cell('a!'))
      expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)
    })
  })

  it('concurrent saves on two cells of the same row keep both results', async () => {
    const { result } = await renderLoaded()
    const de = deferred<TableCell>()
    const en = deferred<TableCell>()
    translationsApi.setValue
      .mockReturnValueOnce(de.promise)
      .mockReturnValueOnce(en.promise)
    const r1 = rowsOf(result)[0]

    act(() => {
      result.current.saveValue(r1, 'de', 'D')
      result.current.saveValue(r1, 'en', 'E')
    })
    await act(async () => en.resolve(cell('E!')))
    await act(async () => de.resolve(cell('D!')))

    expect(rowsOf(result)[0].values).toEqual({ de: cell('D!'), en: cell('E!') })
  })

  it('a pending save marks the cell busy only in its own namespace', async () => {
    const { result } = await renderLoaded()
    const a = deferred<TableCell>()
    translationsApi.setValue.mockReturnValueOnce(a.promise)

    act(() => {
      result.current.saveValue(rowsOf(result)[0], 'de', 'a')
    })
    act(() => result.current.select({ namespace: 'common' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)

    act(() => result.current.select({ namespace: 'translation' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(true)
    await act(async () => a.resolve(cell('a!')))
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)
  })

  it('a key write issued before a project switch does not reload with the old project', async () => {
    const hook = await renderLoaded('p1')
    const create = deferred<unknown>()
    translationsApi.createKey.mockReturnValueOnce(create.promise)

    let created: Promise<boolean> = Promise.resolve(false)
    act(() => {
      created = hook.result.current.createKey('a')
    })
    translationsApi.fetchTable.mockResolvedValueOnce(
      table([row('p2key', 'x', 'y')])
    )
    hook.rerender({ id: 'p2' })
    await waitFor(() =>
      expect(rowsOf(hook.result).map((r) => r.keyId)).toEqual(['p2key'])
    )
    translationsApi.fetchTable.mockClear()

    await act(async () => create.resolve({ id: 'k3' }))

    expect(await created).toBe(true)
    expect(translationsApi.fetchTable).not.toHaveBeenCalledWith(
      'p1',
      expect.anything()
    )
    expect(rowsOf(hook.result).map((r) => r.keyId)).toEqual(['p2key'])
    expect(hook.result.current.isLoading).toBe(false)
  })

  it('callbacks keep their identity across renders', async () => {
    const { result, rerender } = await renderLoaded()
    const first = result.current
    rerender({ id: 'p1' })
    const second = result.current
    for (const name of [
      'select',
      'saveValue',
      'unlink',
      'relink',
      'createKey',
      'renameKey',
      'deleteKey',
      'isBusy',
      'reload',
    ] as const) {
      expect(second[name], name).toBe(first[name])
    }
  })
})

describe('fix round 3: save results never land in a table of another view', () => {
  /**
   * Save in view A (translation), switch to B (common) and let B's table
   * arrive, switch back to A while A's table is still loading (B's rows
   * still shown).
   */
  async function backToAWhileLoading() {
    const hook = await renderLoaded()
    const { result } = hook
    const save = deferred<TableCell>()
    translationsApi.setValue.mockReturnValueOnce(save.promise)
    const [r1] = rowsOf(result)
    let saved: Promise<boolean> = Promise.resolve(false)
    act(() => {
      saved = result.current.saveValue(r1, 'de', 'A neu')
    })

    translationsApi.fetchTable.mockResolvedValueOnce(
      table([row('k1', 'B de', 'B en')])
    )
    act(() => result.current.select({ namespace: 'common' }))
    await waitFor(() => expect(rowsOf(result)[0].values.de.value).toBe('B de'))

    const tableA = deferred<TranslationTable>()
    translationsApi.fetchTable.mockReturnValueOnce(tableA.promise)
    act(() => result.current.select({ namespace: 'translation' }))
    expect(result.current.isLoading).toBe(true)
    return { ...hook, save, saved: () => saved, tableA }
  }

  it('a save of view A settling while B’s rows are still shown leaves the table untouched', async () => {
    const { result, save, saved, tableA } = await backToAWhileLoading()
    const before = result.current.table

    await act(async () => save.resolve(cell('A (server)')))

    expect(result.current.table).toBe(before)
    expect(rowsOf(result)[0].values).toEqual({
      de: cell('B de'),
      en: cell('B en'),
    })
    expect(await saved()).toBe(true)

    await act(async () =>
      tableA.resolve(table([row('k1', 'A (server)', 'Hello')]))
    )
    expect(rowsOf(result)[0].values.de).toEqual(cell('A (server)'))
    expect(result.current.isLoading).toBe(false)
  })

  it('a failing save of view A writes no restore into B’s rows', async () => {
    const { result, save, saved } = await backToAWhileLoading()
    const before = result.current.table

    await act(async () => save.reject(httpError(500)))

    expect(result.current.table).toBe(before)
    expect(rowsOf(result)[0].values.de).toEqual(cell('B de'))
    expect(await saved()).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('The text could not be saved.')
  })

  it('a save of page 1 settling after page 2 arrived is not written', async () => {
    const { result } = await renderLoaded()
    const save = deferred<TableCell>()
    translationsApi.setValue.mockReturnValueOnce(save.promise)
    const [r1] = rowsOf(result)
    let saved: Promise<boolean> = Promise.resolve(false)
    act(() => {
      saved = result.current.saveValue(r1, 'de', 'Seite 1')
    })
    translationsApi.fetchTable.mockResolvedValueOnce(
      table([row('k1', 'P2 de', 'P2 en')], 2)
    )
    act(() => result.current.select({ page: 2 }))
    await waitFor(() => expect(rowsOf(result)[0].values.de.value).toBe('P2 de'))
    const before = result.current.table

    await act(async () => save.resolve(cell('Seite 1')))

    expect(result.current.table).toBe(before)
    expect(rowsOf(result)[0].values.de).toEqual(cell('P2 de'))
    expect(await saved).toBe(true)
  })

  it('withCell keeps the table object when nothing changes', () => {
    const t = table([row('k1', 'Hallo', 'Hello')])
    expect(withCell(t, 'missing', 'de', cell('x'))).toBe(t)
    expect(withCell(t, 'k1', 'fr', cell('x'))).toBe(t)
    expect(withCell(t, 'k1', 'de', cell('Hallo'))).toBe(t)
    const changed = withCell(t, 'k1', 'de', cell('Neu'))
    expect(changed).not.toBe(t)
    expect(changed.rows[0].values.de).toEqual(cell('Neu'))
  })
})

describe('fix round 4: saves are tied to the scope of the rows on screen', () => {
  const scopeOfNs = (namespace: string) =>
    scopeOf({ namespace, search: '', missingOnly: false, page: 1 })

  interface Seen {
    table: TranslationTable | null
    tableScope: string | null
    selectionScope: string
  }

  /**
   * Renders the hook with one distinct table per namespace and records
   * every render, so a test can check all of them, not only the last one.
   */
  async function renderLogged() {
    server.project = {
      ...(server.project as ProjectFixture),
      namespaces: ['translation', 'common', 'admin'],
    }
    const tables = {
      translation: table([row('k1', 'A de', 'A en')]),
      common: table([row('k1', 'B de', 'B en')]),
      admin: table([row('k1', 'C de', 'C en')]),
    }
    const scopeByTable = new Map<TranslationTable, string>([
      [tables.translation, scopeOfNs('translation')],
      [tables.common, scopeOfNs('common')],
      [tables.admin, scopeOfNs('admin')],
    ])
    translationsApi.fetchTable.mockResolvedValueOnce(tables.translation)
    const seen: Seen[] = []
    const hook = renderHook(() => {
      const value = useTranslations('p1')
      seen.push({
        table: value.table,
        tableScope: value.tableScope,
        selectionScope: scopeOf(value.selection),
      })
      return value
    })
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    /** In every render so far, `tableScope` named the scope of the rows in `table`. */
    const expectScopeMatchesRows = () => {
      for (const s of seen)
        expect(s.tableScope).toBe(
          s.table ? (scopeByTable.get(s.table) ?? 'unknown table') : null
        )
    }
    return { ...hook, tables, seen, expectScopeMatchesRows }
  }

  it('tableScope names the scope the table was loaded for, also while another one loads', async () => {
    const { result, tables, expectScopeMatchesRows } = await renderLogged()
    expect(result.current.tableScope).toBe(scopeOfNs('translation'))
    expect(result.current.tableScope).toBe(scopeOf(result.current.selection))

    const tableB = deferred<TranslationTable>()
    translationsApi.fetchTable.mockReturnValueOnce(tableB.promise)
    act(() => result.current.select({ namespace: 'common' }))

    expect(result.current.table).toBe(tables.translation)
    expect(result.current.tableScope).toBe(scopeOfNs('translation'))
    expect(scopeOf(result.current.selection)).toBe(scopeOfNs('common'))

    await act(async () => tableB.resolve(tables.common))

    expect(result.current.table).toBe(tables.common)
    expect(result.current.tableScope).toBe(scopeOfNs('common'))
    expect(result.current.tableScope).toBe(scopeOf(result.current.selection))
    expectScopeMatchesRows()
  })

  it('tableScope does not depend on page, search or the missing-only flag', async () => {
    const { result } = await renderLoaded()
    const scope = result.current.tableScope
    expect(scope).toBe(scopeOf(result.current.selection))

    act(() => result.current.select({ page: 2, missingOnly: true }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    vi.useFakeTimers()
    act(() => result.current.select({ search: 'abc' }))
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    vi.useRealTimers()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(translationsApi.fetchTable).toHaveBeenCalledTimes(3)
    expect(result.current.tableScope).toBe(scope)
    expect(scopeOf(result.current.selection)).toBe(scope)
  })

  it('tableScope is null without a table', async () => {
    const { result } = await renderLoaded(null)
    expect(result.current.table).toBeNull()
    expect(result.current.tableScope).toBeNull()
  })

  it('response of B and a switch to C landing in one render: the rows keep the scope of B and a save is refused', async () => {
    const { result, tables, seen, expectScopeMatchesRows } =
      await renderLogged()
    const tableB = deferred<TranslationTable>()
    const tableC = deferred<TranslationTable>()
    translationsApi.fetchTable
      .mockReturnValueOnce(tableB.promise)
      .mockReturnValueOnce(tableC.promise)
    act(() => result.current.select({ namespace: 'common' }))
    const rendersBefore = seen.length

    await act(async () => {
      tableB.resolve(tables.common)
      // let the hook apply the response of B; nothing renders inside act()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      result.current.select({ namespace: 'admin' })
    })

    // the rows of B were never rendered together with selection B
    expect(
      seen
        .slice(rendersBefore)
        .filter(
          (s) =>
            s.table === tables.common &&
            s.selectionScope === scopeOfNs('common')
        )
    ).toEqual([])
    expect(result.current.table).toBe(tables.common)
    expect(result.current.tableScope).toBe(scopeOfNs('common'))
    expect(scopeOf(result.current.selection)).toBe(scopeOfNs('admin'))
    expectScopeMatchesRows()

    let saved = true
    await act(async () => {
      saved = await result.current.saveValue(rowsOf(result)[0], 'de', 'x')
    })

    expect(saved).toBe(false)
    expect(translationsApi.setValue).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(result.current.table).toBe(tables.common)
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)

    await act(async () => tableC.resolve(tables.admin))
    expect(result.current.tableScope).toBe(scopeOfNs('admin'))
    translationsApi.setValue.mockResolvedValueOnce(cell('C de'))
    await act(async () => {
      saved = await result.current.saveValue(rowsOf(result)[0], 'de', 'C de')
    })
    expect(saved).toBe(true)
    expect(translationsApi.setValue).toHaveBeenCalledWith('k1', {
      language: 'de',
      value: 'C de',
    })
  })

  it('while another scope loads, saveValue, unlink and relink send nothing', async () => {
    const { result, tables } = await renderLogged()
    const tableB = deferred<TranslationTable>()
    translationsApi.fetchTable.mockReturnValueOnce(tableB.promise)
    const [rowA] = rowsOf(result)
    act(() => result.current.select({ namespace: 'common' }))

    let saved = true
    let brandSaved = true
    let unlinked = true
    let relinked = true
    await act(async () => {
      saved = await result.current.saveValue(rowA, 'de', 'x')
      brandSaved = await result.current.saveValue(rowA, 'de', 'x', 'b1')
      unlinked = await result.current.unlink(rowA, 'de', 'b1')
      relinked = await result.current.relink(rowA, 'en', 'b1')
    })

    expect(saved).toBe(false)
    expect(brandSaved).toBe(false)
    expect(unlinked).toBe(false)
    expect(relinked).toBe(false)
    expect(translationsApi.setValue).not.toHaveBeenCalled()
    expect(translationsApi.unlinkValue).not.toHaveBeenCalled()
    expect(translationsApi.linkValue).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(result.current.table).toBe(tables.translation)
    expect(result.current.isBusy(cellKey('k1', 'de'))).toBe(false)
    expect(result.current.isBusy(cellKey('k1', 'de', 'b1'))).toBe(false)
    expect(result.current.isBusy(cellKey('k1', 'en', 'b1'))).toBe(false)

    await act(async () => tableB.resolve(tables.common))
  })

  it('a response overtaken by a newer selection in the same tick is dropped; tableScope keeps naming the rows shown', async () => {
    const { result, tables, expectScopeMatchesRows } = await renderLogged()
    const tableB = deferred<TranslationTable>()
    const tableC = deferred<TranslationTable>()
    translationsApi.fetchTable
      .mockReturnValueOnce(tableB.promise)
      .mockReturnValueOnce(tableC.promise)
    act(() => result.current.select({ namespace: 'common' }))

    await act(async () => {
      tableB.resolve(tables.common)
      result.current.select({ namespace: 'admin' })
    })

    expect(result.current.table).toBe(tables.translation)
    expect(result.current.tableScope).toBe(scopeOfNs('translation'))
    expect(result.current.isLoading).toBe(true)

    await act(async () => tableC.resolve(tables.admin))

    expect(result.current.table).toBe(tables.admin)
    expect(result.current.tableScope).toBe(scopeOfNs('admin'))
    expectScopeMatchesRows()
  })

  it('a reload falling back to another namespace refuses saves until its table arrives', async () => {
    const { result } = await renderLoaded()
    act(() => result.current.select({ namespace: 'common' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const scopeCommon = result.current.tableScope
    const [rowCommon] = rowsOf(result)

    server.project = {
      ...(server.project as ProjectFixture),
      namespaces: ['translation'],
    }
    const tableTranslation = deferred<TranslationTable>()
    translationsApi.fetchTable.mockReturnValueOnce(tableTranslation.promise)
    let reloaded: Promise<void> = Promise.resolve()
    act(() => {
      reloaded = result.current.reload()
    })
    await waitFor(() =>
      expect(result.current.selection.namespace).toBe('translation')
    )

    expect(result.current.tableScope).toBe(scopeCommon)
    let saved = true
    await act(async () => {
      saved = await result.current.saveValue(rowCommon, 'de', 'x')
    })
    expect(saved).toBe(false)
    expect(translationsApi.setValue).not.toHaveBeenCalled()

    await act(async () => {
      tableTranslation.resolve(table([row('k1', 'T', 'T')]))
      await reloaded
    })
    expect(result.current.tableScope).toBe(scopeOf(result.current.selection))
  })
})
