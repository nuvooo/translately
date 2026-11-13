import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useReducer } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import i18n from '@/i18n'
import type { TableRow, TranslationTable } from './types'
import type { useTranslations as UseTranslations } from './useTranslations'

type Hook = ReturnType<typeof UseTranslations>

const PROJECT_ID = 'p1'

const role = vi.hoisted(() => ({ current: 'ADMIN' }))
const store = vi.hoisted(() => ({
  hook: null as unknown,
  listeners: new Set<() => void>(),
}))

vi.mock('@/lib/workspace', () => ({
  refreshWorkspace: vi.fn(() => Promise.resolve()),
  useWorkspace: () => ({
    projects: [{ id: 'p1', name: 'Shop', key: 'shop', organizationId: 'o1' }],
    organizations: [{ id: 'o1', name: 'Acme', role: role.current }],
    isLoading: false,
    error: null,
    projectsByOrg: () => [],
  }),
}))

// The hook is replaced by a small store; `cellKey` stays the real one.
vi.mock('./useTranslations', async (importActual) => {
  const actual = await importActual<typeof import('./useTranslations')>()
  return {
    ...actual,
    useTranslations: () => {
      const [, rerender] = useReducer((n: number) => n + 1, 0)
      useEffect(() => {
        store.listeners.add(rerender)
        return () => {
          store.listeners.delete(rerender)
        }
      }, [])
      return store.hook
    },
  }
})

// AI status and suggestions: never a real request.
const ai = vi.hoisted(() => ({
  enabled: false,
  suggest: (() => Promise.resolve(null)) as (...args: unknown[]) => unknown,
}))
vi.mock('./useAiTranslation', () => ({
  useAiTranslation: () => ({ enabled: ai.enabled, suggest: ai.suggest }),
}))

// The real table, wrapped so its props can be inspected.
vi.mock('./TranslationsTable', async (importActual) => {
  const actual = await importActual<typeof import('./TranslationsTable')>()
  return { ...actual, TranslationsTable: vi.fn(actual.TranslationsTable) }
})

// Only the language writes and the import are replaced; everything else stays real.
vi.mock('./api', async (importActual) => {
  const actual = await importActual<typeof import('./api')>()
  return {
    ...actual,
    setProjectLanguages: vi.fn(),
    setBrandLanguages: vi.fn(),
    previewImport: vi.fn(),
    applyImport: vi.fn(),
  }
})

import * as translationsApi from './api'
import TranslationsPage from './TranslationsPage'
import { TranslationsTable } from './TranslationsTable'
import { scopeOf } from './translationsState'

const ROW_A: TableRow = {
  keyId: 'k1',
  key: 'checkout.title',
  description: null,
  locked: false,
  values: {
    de: { value: 'Kasse', inherited: false },
    en: { value: 'Checkout', inherited: false },
  },
  overrides: { b1: { de: 'Premium-Kasse' } },
}
const ROW_B: TableRow = {
  keyId: 'k2',
  key: 'checkout.submit',
  description: null,
  locked: false,
  values: {
    de: { value: 'Jetzt kaufen', inherited: false },
    en: { value: null, inherited: false },
  },
  overrides: {},
}
const BRAND = { id: 'b1', key: 'premium', name: 'Premium', languages: ['de'] }

function table(overrides: Partial<TranslationTable> = {}): TranslationTable {
  return {
    languages: ['de', 'en'],
    namespaces: ['translation'],
    rows: [ROW_A, ROW_B],
    total: 2,
    page: 1,
    pageSize: 50,
    ...overrides,
  }
}

const PROJECT = {
  id: PROJECT_ID,
  key: 'shop',
  type: 'SINGLE' as 'SINGLE' | 'MULTI',
  languages: ['de', 'en'],
  namespaces: ['translation'],
}
const SELECTION = {
  namespace: 'translation',
  search: '',
  missingOnly: false,
  page: 1,
}

/** Opens the actions menu of the toolbar, unless it is open already. */
function openActions() {
  const trigger = screen.getByRole('button', { name: 'Aktionen' })
  if (trigger.getAttribute('aria-expanded') !== 'true')
    fireEvent.keyDown(trigger, { key: 'Enter' })
}
/** One entry of the actions menu, or null when the menu does not offer it. */
function actionItem(name: string): HTMLElement | null {
  openActions()
  return screen.queryByRole('menuitem', { name })
}

/**
 * A hook state at rest: unless a test says otherwise, the table was loaded
 * for the selection's scope (as after every completed load).
 */
function makeHook(overrides: Partial<Hook> = {}): Hook {
  const selection = overrides.selection ?? SELECTION
  const loaded = overrides.table === undefined || overrides.table !== null
  return {
    tableScope: loaded ? scopeOf(selection) : null,
    project: PROJECT,
    brands: [],
    selection: SELECTION,
    select: vi.fn(),
    table: table(),
    isLoading: false,
    error: null,
    isBusy: () => false,
    saveValue: vi.fn(() => Promise.resolve(true)),
    unlink: vi.fn(() => Promise.resolve(true)),
    relink: vi.fn(() => Promise.resolve(true)),
    createKey: vi.fn(() => Promise.resolve(true)),
    renameKey: vi.fn(() => Promise.resolve(true)),
    setKeyLocked: vi.fn(() => Promise.resolve(true)),
    deleteKey: vi.fn(() => Promise.resolve(true)),
    reload: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

const hook = () => store.hook as Hook

function setHook(overrides: Partial<Hook> = {}) {
  store.hook = makeHook(overrides)
}

/**
 * Changes the hook's state and re-renders the page like the real hook.
 * Nothing is derived: `tableScope` only changes when a test passes it.
 */
function notify(patch: Partial<Hook>) {
  store.hook = { ...hook(), ...patch }
  for (const listener of store.listeners) listener()
}

/** The patch of a table response arriving for the current selection. */
function arrived(next: TranslationTable): Partial<Hook> {
  return {
    table: next,
    tableScope: scopeOf(hook().selection),
    isLoading: false,
  }
}

/** The current table with one cell replaced (rows other than `keyId` kept). */
function withCell(keyId: string, lang: string, value: string) {
  const t = hook().table
  if (!t) throw new Error('no table')
  return {
    ...t,
    rows: t.rows.map((r) =>
      r.keyId === keyId
        ? { ...r, values: { ...r.values, [lang]: { value, inherited: false } } }
        : r
    ),
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/translations`]}>
      <Routes>
        <Route
          path="/projects/:projectId/translations"
          element={<TranslationsPage />}
        />
      </Routes>
    </MemoryRouter>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('TranslationsPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    role.current = 'ADMIN'
    setHook()
  })

  it('zeigt die Überschrift', () => {
    renderPage()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Übersetzungen' })
    ).toBeInTheDocument()
  })

  it('Spalten = Sprachen aus der Tabelle', () => {
    setHook({ table: table({ languages: ['de', 'en', 'fr'] }) })
    renderPage()
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers.slice(0, 4)).toEqual(['Key', 'de', 'en', 'fr'])
    expect(
      screen.getByRole('button', { name: 'checkout.title – de' })
    ).toBeInTheDocument()
    expect(screen.getByText('Kasse')).toBeInTheDocument()
    expect(screen.getAllByText('fehlt').length).toBeGreaterThan(0)
  })

  it('kompakte Toolbar: keine Tabs, kein „Kopieren“, keine Brand-Auswahl', () => {
    role.current = 'MEMBER'
    setHook({ project: { ...PROJECT, type: 'MULTI' }, brands: [BRAND] })
    renderPage()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('tabpanel')).toBeNull()
    expect(screen.queryByRole('button', { name: /Kopieren/ })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Brand' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Ziel' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/environment/i)
  })

  it('MULTI-Projekt mit Brand → Pfeil-Buttons zum Aufklappen; SINGLE → keine', () => {
    const { unmount } = renderPage()
    expect(screen.queryByRole('button', { name: /^Brands für/ })).toBeNull()
    unmount()

    setHook({ project: { ...PROJECT, type: 'MULTI' }, brands: [BRAND] })
    renderPage()
    expect(
      screen.getByRole('button', { name: 'Brands für checkout.title anzeigen' })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getByRole('button', {
        name: 'Brands für checkout.submit anzeigen',
      })
    ).toBeInTheDocument()
  })

  it('SINGLE-Projekt ignoriert geladene Brands', () => {
    setHook({ brands: [BRAND] })
    renderPage()
    expect(screen.queryByRole('button', { name: /^Brands für/ })).toBeNull()
  })

  it('Namespace-Auswahl nur bei mehr als einem Namespace', () => {
    const { unmount } = renderPage()
    expect(
      screen.queryByRole('combobox', { name: 'Namespace' })
    ).not.toBeInTheDocument()
    unmount()
    setHook({ project: { ...PROJECT, namespaces: ['translation', 'admin'] } })
    renderPage()
    expect(
      screen.getByRole('combobox', { name: 'Namespace' })
    ).toBeInTheDocument()
  })

  it('zeigt die Legende nur bei Brands', () => {
    const { unmount } = renderPage()
    expect(
      screen.queryByText('Text kommt aus dem Standard')
    ).not.toBeInTheDocument()
    unmount()
    setHook({ project: { ...PROJECT, type: 'MULTI' }, brands: [BRAND] })
    renderPage()
    expect(screen.getByText('Text kommt aus dem Standard')).toBeInTheDocument()
  })

  it('Suche und „nur fehlende“ laufen über select', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByRole('searchbox', { name: 'Suchen' }), 'k')
    expect(hook().select).toHaveBeenCalledWith({ search: 'k' })
    await user.click(screen.getByRole('switch', { name: 'Nur fehlende' }))
    expect(hook().select).toHaveBeenCalledWith({ missingOnly: true })
  })

  it('Suche ist auf 200 Zeichen begrenzt (der Server lehnt längere ab)', () => {
    renderPage()
    expect(screen.getByRole('searchbox', { name: 'Suchen' })).toHaveAttribute(
      'maxLength',
      '200'
    )
  })

  it('leere Sprachliste → Hinweis statt Tabelle', () => {
    setHook({
      project: { ...PROJECT, languages: [] },
      table: table({ languages: [], rows: [], total: 0 }),
    })
    renderPage()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      screen.getByText('Noch keine Sprachen im Projekt')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sprachen verwalten' })
    ).toBeInTheDocument()
  })

  it('leere Sprachliste ohne ADMIN → Hinweis ohne Button', () => {
    role.current = 'MEMBER'
    setHook({ project: { ...PROJECT, languages: [] }, table: table() })
    renderPage()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      screen.getByText('Noch keine Sprachen im Projekt')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sprachen verwalten' })
    ).not.toBeInTheDocument()
  })

  it('ohne Projektsprachen, aber Brand mit Sprachen → Tabelle statt „keine Sprachen“', () => {
    setHook({
      project: { ...PROJECT, type: 'MULTI', languages: [] },
      brands: [BRAND],
      table: table({ languages: ['de'] }),
    })
    renderPage()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(
      screen.queryByText('Noch keine Sprachen im Projekt')
    ).not.toBeInTheDocument()
  })

  it('VIEWER sieht keinen „Key anlegen“-Button und nichts zum Schreiben', async () => {
    role.current = 'VIEWER'
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Key anlegen' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Aktionen für/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /checkout\.title/ })
    ).not.toBeInTheDocument()
    await user.click(screen.getByText('Kasse'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('VIEWER bekommt bei leerem Projekt keine Schreib-Buttons', () => {
    role.current = 'VIEWER'
    setHook({ table: table({ rows: [], total: 0 }) })
    renderPage()
    expect(screen.getByText('Noch keine Keys')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Key anlegen' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'JSON importieren' })
    ).toBeNull()
  })

  it('Zelle A speichern (Antwort hängt), Zelle B tippen, Antwort A → Entwurf B unverändert', async () => {
    const user = userEvent.setup()
    const pending = deferred<boolean>()
    setHook({
      saveValue: vi.fn((row: TableRow, language: string, value: string) => {
        // optimistic update like the real hook, then the request hangs
        notify({ table: withCell(row.keyId, language, value) })
        return pending.promise
      }) as Hook['saveValue'],
    })
    renderPage()

    await user.click(
      screen.getByRole('button', { name: 'checkout.title – de' })
    )
    await user.keyboard(' A{Enter}')
    expect(hook().saveValue).toHaveBeenCalledWith(ROW_A, 'de', 'Kasse A')

    await user.click(
      screen.getByRole('button', { name: 'checkout.submit – en' })
    )
    await user.keyboard('Entwurf B')
    const editorB = screen.getByRole('textbox', {
      name: 'checkout.submit – en',
    }) as HTMLTextAreaElement
    expect(editorB.value).toBe('Entwurf B')
    const tableBefore = hook().table

    // Answer for A: a new table prop where every row and cell is a new object
    // (as after a reload), so B's cell props change too; the save resolves.
    await act(async () => {
      const confirmed = withCell('k1', 'de', 'Kasse A')
      notify({ table: structuredClone(confirmed) })
      pending.resolve(true)
    })
    expect(hook().table).not.toBe(tableBefore)

    expect(
      screen.queryByRole('textbox', { name: 'checkout.title – de' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('Kasse A')).toBeInTheDocument()
    const stillB = screen.getByRole('textbox', {
      name: 'checkout.submit – en',
    }) as HTMLTextAreaElement
    expect(stillB).toBe(editorB)
    expect(stillB.value).toBe('Entwurf B')
    expect(stillB).toHaveFocus()
    expect(hook().saveValue).toHaveBeenCalledTimes(1)
  })

  /** Hook whose `select` changes the selection; saves fail and record the namespace. */
  function setFailingViewHook(overrides: Partial<Hook> = {}) {
    const views: string[] = []
    setHook({
      project: { ...PROJECT, namespaces: ['translation', 'admin'] },
      select: vi.fn((patch) =>
        notify({ selection: { ...hook().selection, ...patch } })
      ) as Hook['select'],
      saveValue: vi.fn(() => {
        views.push(hook().selection.namespace)
        return Promise.resolve(false)
      }) as Hook['saveValue'],
      ...overrides,
    })
    return views
  }

  /** Retries a still visible editor with Enter (the bug path). */
  async function retryIfEditorLeft(user: ReturnType<typeof userEvent.setup>) {
    const stale = screen.queryByRole('textbox')
    if (!stale) return
    await user.click(stale)
    await user.keyboard('{Enter}')
  }

  /** The area below the toolbar (table, skeleton or empty state). */
  const tableArea = () => screen.getByTestId('translations-body')

  it('Fehlschlag in „translation“, Namespace-Wechsel → Editor weg, nichts landet in „admin“', async () => {
    const user = userEvent.setup()
    const views = setFailingViewHook()
    renderPage()
    await user.click(
      screen.getByRole('button', { name: 'checkout.title – de' })
    )
    await user.keyboard(' Neu{Enter}')
    expect(screen.getByText('Nicht gespeichert')).toBeInTheDocument()

    act(() => hook().select({ namespace: 'admin' }))
    expect(hook().selection.namespace).toBe('admin')
    await retryIfEditorLeft(user)

    expect(views.length).toBeGreaterThan(0)
    expect(views.filter((v) => v !== 'translation')).toEqual([])
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Nicht gespeichert')).not.toBeInTheDocument()
  })

  it('offener Editor übersteht Suche und neue Tabelle in derselben Sicht', async () => {
    const user = userEvent.setup()
    setFailingViewHook()
    renderPage()
    await user.click(
      screen.getByRole('button', { name: 'checkout.submit – en' })
    )
    await user.keyboard('Entwurf')
    const editor = screen.getByRole('textbox', {
      name: 'checkout.submit – en',
    }) as HTMLTextAreaElement

    act(() => {
      notify({
        selection: { ...hook().selection, search: 'checkout' },
        table: structuredClone(hook().table) as TranslationTable,
      })
    })
    expect(screen.getByRole('textbox', { name: 'checkout.submit – en' })).toBe(
      editor
    )
    expect(editor.value).toBe('Entwurf')
    expect(editor).toHaveFocus()
    expect(hook().saveValue).not.toHaveBeenCalled()
  })

  /** MULTI project with one brand offering de and en; ROW_A has an own de text. */
  function setBrandHook() {
    setHook({
      project: { ...PROJECT, type: 'MULTI' },
      brands: [{ ...BRAND, languages: ['de', 'en'] }],
    })
  }

  const expandRow = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(
      screen.getByRole('button', { name: 'Brands für checkout.title anzeigen' })
    )

  async function expectLocked(user: ReturnType<typeof userEvent.setup>) {
    expect(tableArea()).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'checkout.title – de' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByText('Kasse'))
    await user.keyboard('{Enter}{F2}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    // Brand rows stay visible but offer nothing to write.
    if (screen.queryByRole('rowheader', { name: 'Premium' }) === null) {
      await expandRow(user)
    }
    expect(screen.getByRole('rowheader', { name: 'Premium' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /Wieder verknüpfen|Lösen/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Aktionen für/ })
    ).not.toBeInTheDocument()
    expect(hook().saveValue).not.toHaveBeenCalled()
    expect(hook().unlink).not.toHaveBeenCalled()
    expect(hook().relink).not.toHaveBeenCalled()
  }

  it('Namespace-Wechsel lädt noch → alte Zeilen sind gesperrt, neue Tabelle entsperrt', async () => {
    const user = userEvent.setup()
    setBrandHook()
    renderPage()

    // namespace switched, the old table object is still shown while loading
    act(() =>
      notify({
        selection: { ...hook().selection, namespace: 'admin' },
        isLoading: true,
      })
    )
    await expectLocked(user)

    // the new namespace's table arrives → editable again
    act(() =>
      notify(arrived(structuredClone(hook().table) as TranslationTable))
    )
    expect(tableArea()).not.toHaveAttribute('aria-busy')
    await user.click(
      screen.getByRole('button', { name: 'checkout.title – de' })
    )
    expect(
      screen.getByRole('textbox', { name: 'checkout.title – de' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Aktionen für checkout.title' })
    ).toBeInTheDocument()
  })

  it('neue Tabelle UND andere Auswahl im selben Render → gesperrt, bis die Tabelle der Auswahl da ist', async () => {
    const user = userEvent.setup()
    setBrandHook()
    renderPage()
    expect(
      screen.getByRole('button', { name: 'checkout.title – de' })
    ).toBeInTheDocument()

    // The response for "admin" and the switch to "other" land in ONE render:
    // a new table object (loaded for "admin") together with the selection "other".
    act(() =>
      notify({
        selection: { ...hook().selection, namespace: 'other' },
        table: structuredClone(hook().table) as TranslationTable,
        tableScope: 'admin',
        isLoading: true,
      })
    )
    await expectLocked(user)
    expect(
      screen.getByRole('button', { name: 'Key anlegen' })
    ).toBeInTheDocument()

    // the table of "other" arrives → editable again
    act(() =>
      notify(arrived(structuredClone(hook().table) as TranslationTable))
    )
    expect(tableArea()).not.toHaveAttribute('aria-busy')
    await user.click(
      screen.getByRole('button', { name: 'checkout.title – de' })
    )
    expect(
      screen.getByRole('textbox', { name: 'checkout.title – de' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Wieder verknüpfen: checkout.title – de – Premium',
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Aktionen für checkout.title' })
    ).toBeInTheDocument()
  })

  it('allein tableScope entscheidet: fremder Scope sperrt, auch ohne Laden und bei unverändertem Tabellenobjekt', async () => {
    const user = userEvent.setup()
    setBrandHook()
    renderPage()
    const sameTable = hook().table
    const own = hook().tableScope

    act(() => notify({ tableScope: 'admin' }))
    expect(hook().table).toBe(sameTable)
    expect(hook().isLoading).toBe(false)
    await expectLocked(user)

    act(() => notify({ tableScope: own }))
    expect(tableArea()).not.toHaveAttribute('aria-busy')
    await user.click(
      screen.getByRole('button', { name: 'checkout.title – de' })
    )
    expect(
      screen.getByRole('textbox', { name: 'checkout.title – de' })
    ).toBeInTheDocument()
  })

  it('Neuladen in derselben Sicht: offener Editor bleibt speicherbar, neuer Editor öffnet', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      screen.getByRole('button', { name: 'checkout.submit – en' })
    )
    await user.keyboard('Entwurf')

    act(() =>
      notify({
        selection: { ...hook().selection, search: 'checkout' },
        isLoading: true,
      })
    )
    const editorB = screen.getByRole('textbox', {
      name: 'checkout.submit – en',
    }) as HTMLTextAreaElement
    expect(editorB.value).toBe('Entwurf')
    await user.keyboard('{Enter}')
    expect(hook().saveValue).toHaveBeenCalledWith(ROW_B, 'en', 'Entwurf')

    await user.click(
      screen.getByRole('button', { name: 'checkout.title – de' })
    )
    await user.keyboard(' neu')
    const editorA = screen.getByRole('textbox', {
      name: 'checkout.title – de',
    }) as HTMLTextAreaElement

    act(() =>
      notify({
        table: structuredClone(hook().table) as TranslationTable,
        isLoading: false,
      })
    )
    expect(screen.getByRole('textbox', { name: 'checkout.title – de' })).toBe(
      editorA
    )
    expect(editorA.value).toBe('Kasse neu')
  })

  it('erste Tabelle nach dem Laden ist bearbeitbar', async () => {
    const user = userEvent.setup()
    setHook({ table: null, isLoading: true })
    renderPage()
    expect(screen.getByTestId('translations-skeleton')).toBeInTheDocument()
    act(() => notify(arrived(table())))
    await user.click(
      screen.getByRole('button', { name: 'checkout.title – de' })
    )
    expect(
      screen.getByRole('textbox', { name: 'checkout.title – de' })
    ).toBeInTheDocument()
  })

  it('Brand-Zeile: „Wieder verknüpfen“ ruft relink, „Lösen“ ruft unlink, Speichern mit brandId', async () => {
    const user = userEvent.setup()
    setBrandHook()
    renderPage()
    await expandRow(user)
    await user.click(
      screen.getByRole('button', {
        name: 'Wieder verknüpfen: checkout.title – de – Premium',
      })
    )
    expect(hook().relink).toHaveBeenCalledWith(ROW_A, 'de', 'b1')

    await user.click(
      screen.getByRole('button', {
        name: 'Lösen: checkout.title – en – Premium',
      })
    )
    expect(hook().unlink).toHaveBeenCalledWith(ROW_A, 'en', 'b1')
    // unlink resolved true → the editor opens with the standard text
    const editor = await screen.findByRole('textbox', {
      name: 'checkout.title – en – Premium',
    })
    await user.clear(editor)
    await user.type(editor, 'Premium checkout{Enter}')
    expect(hook().saveValue).toHaveBeenCalledWith(
      ROW_A,
      'en',
      'Premium checkout',
      'b1'
    )
  })

  it('legt einen Key an; Fehler halten den Dialog offen', async () => {
    const user = userEvent.setup()
    const createKey = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    setHook({ createKey })
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Key anlegen' }))
    const dialog = await screen.findByRole('dialog')
    const keyInput = within(dialog).getByLabelText('Key')
    await user.type(keyInput, 'a..b')
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    expect(
      within(dialog).getByText(
        'Der Key darf nicht mit einem Punkt beginnen oder enden und keine zwei Punkte hintereinander enthalten.'
      )
    ).toBeInTheDocument()
    expect(keyInput).toHaveAttribute('aria-invalid', 'true')
    expect(createKey).not.toHaveBeenCalled()

    await user.clear(keyInput)
    await user.type(keyInput, 'cart.empty')
    await user.type(
      within(dialog).getByLabelText(/Beschreibung/),
      'Leerer Korb'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    expect(createKey).toHaveBeenCalledWith('cart.empty', 'Leerer Korb')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Key')).toHaveValue('cart.empty')

    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    expect(createKey).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Zeilenmenü: MEMBER benennt um, sieht aber kein Löschen', async () => {
    role.current = 'MEMBER'
    const user = userEvent.setup()
    renderPage()
    await user.click(
      screen.getByRole('button', { name: 'Aktionen für checkout.title' })
    )
    await screen.findByRole('menuitem', { name: 'Umbenennen' })
    expect(
      screen.queryByRole('menuitem', { name: 'Löschen' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Umbenennen' }))
    const dialog = await screen.findByRole('dialog')
    const keyInput = within(dialog).getByLabelText('Key')
    expect(keyInput).toHaveValue('checkout.title')
    await user.clear(keyInput)
    await user.type(keyInput, 'checkout.heading')
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }))
    expect(hook().renameKey).toHaveBeenCalledWith(ROW_A, 'checkout.heading')
  })

  it('Zeilenmenü: ADMIN löscht nach Rückfrage', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      screen.getByRole('button', { name: 'Aktionen für checkout.title' })
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Löschen' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('checkout.title')
    expect(dialog).toHaveTextContent('in allen Sprachen und Brands')
    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }))
    expect(hook().deleteKey).toHaveBeenCalledWith(ROW_A)
  })

  it('Seitenwechsel bei mehr Keys als pageSize', async () => {
    const user = userEvent.setup()
    setHook({ table: table({ total: 120, pageSize: 50, page: 1 }) })
    renderPage()
    expect(screen.getByText('1–50 von 120')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Vorherige Seite' })
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Nächste Seite' }))
    expect(hook().select).toHaveBeenCalledWith({ page: 2 })
  })

  it('keine Keys → EmptyState mit „Key anlegen“ und „JSON importieren“', async () => {
    const user = userEvent.setup()
    setHook({ table: table({ rows: [], total: 0 }) })
    renderPage()
    expect(screen.getByText('Noch keine Keys')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'JSON importieren' })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Key anlegen' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('keine Treffer → Filter zurücksetzen', async () => {
    const user = userEvent.setup()
    setHook({
      selection: { ...SELECTION, search: 'xyz' },
      table: table({ rows: [], total: 0 }),
    })
    renderPage()
    expect(screen.getByText('Keine Treffer')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Filter zurücksetzen' })
    )
    expect(hook().select).toHaveBeenCalledWith({
      search: '',
      missingOnly: false,
      page: 1,
    })
  })

  it('leere Seite ohne Filter (Keys woanders gelöscht) → zur ersten Seite', async () => {
    const user = userEvent.setup()
    setHook({
      selection: { ...SELECTION, page: 3 },
      table: table({ rows: [], total: 60, page: 3 }),
    })
    renderPage()
    expect(screen.getByText('Diese Seite ist leer')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Filter zurücksetzen' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Zur ersten Seite' }))
    expect(hook().select).toHaveBeenCalledWith({ page: 1 })
  })

  it('Key-Dialog startet beim Öffnen leer, nicht mit alten Werten', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      screen.getByRole('button', { name: 'Aktionen für checkout.title' })
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'Umbenennen' })
    )
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Key')).toHaveValue('checkout.title')
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Key anlegen' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Key')).toHaveValue('')
    await user.type(within(dialog).getByLabelText('Key'), 'x.')
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))

    await user.click(screen.getByRole('button', { name: 'Key anlegen' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Key')).toHaveValue('')
    expect(
      within(dialog).queryByText(/nicht mit einem Punkt beginnen/)
    ).not.toBeInTheDocument()
  })

  it('Laden → Skeleton', () => {
    setHook({ project: null, table: null, isLoading: true })
    renderPage()
    expect(screen.getByTestId('translations-skeleton')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('lädt die Tabelle neu, ohne sie auszublenden', () => {
    setHook({ isLoading: true })
    renderPage()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('translations-body')).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(screen.queryByRole('tabpanel')).toBeNull()
  })

  it('not-found und failed', async () => {
    const user = userEvent.setup()
    setHook({ project: null, table: null, error: 'not-found' })
    const { unmount } = renderPage()
    expect(screen.getByText('Projekt nicht gefunden')).toBeInTheDocument()
    unmount()

    setHook({ project: null, table: null, error: 'failed' })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Die Übersetzungen konnten nicht geladen werden.'
    )
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(hook().reload).toHaveBeenCalled()
  })

  it('zeigt die Seite auf Englisch', async () => {
    await i18n.changeLanguage('en')
    try {
      renderPage()
      expect(
        screen.getByRole('heading', { level: 1, name: 'Translations' })
      ).toBeInTheDocument()
      expect(screen.getAllByText('missing').length).toBeGreaterThan(0)
    } finally {
      await i18n.changeLanguage('de')
    }
  })

  it('bietet Konfigurationsbeispiel und Export auch einem VIEWER an', () => {
    role.current = 'VIEWER'
    renderPage()
    expect(actionItem('Für i18next einrichten')).not.toHaveAttribute(
      'aria-disabled'
    )
    expect(actionItem('Exportieren')).not.toHaveAttribute('aria-disabled')
  })

  it('bietet das Konfigurationsbeispiel auch bei leerer Tabelle an', () => {
    setHook({ table: table({ rows: [], total: 0 }) })
    renderPage()
    expect(actionItem('Für i18next einrichten')).not.toHaveAttribute(
      'aria-disabled'
    )
  })

  it('sperrt den Export, solange die Tabelle zu einer anderen Ansicht gehört', () => {
    const own = hook().tableScope
    act(() =>
      notify({
        tableScope: scopeOf({ ...hook().selection, namespace: 'other' }),
      })
    )
    renderPage()
    expect(actionItem('Exportieren')).toHaveAttribute('aria-disabled', 'true')
    expect(actionItem('Für i18next einrichten')).not.toHaveAttribute(
      'aria-disabled'
    )
    act(() => notify({ tableScope: own }))
    expect(actionItem('Exportieren')).not.toHaveAttribute('aria-disabled')
  })
})

describe('TranslationsPage – KI-Vorschlag', () => {
  const tableProps = () => {
    const calls = vi.mocked(TranslationsTable).mock.calls
    return calls[calls.length - 1][0]
  }

  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
    ai.enabled = false
  })
  beforeEach(() => {
    role.current = 'MEMBER'
    ai.enabled = true
    vi.mocked(TranslationsTable).mockClear()
    setHook()
  })

  it('MEMBER mit aktiver KI: die Tabelle bekommt suggest als onSuggest', () => {
    renderPage()
    expect(tableProps().onSuggest).toBe(ai.suggest)
  })

  it('KI nicht aktiv: die Tabelle bekommt kein onSuggest', () => {
    ai.enabled = false
    renderPage()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(tableProps().onSuggest).toBeUndefined()
  })

  it('VIEWER: die Tabelle bekommt kein onSuggest', () => {
    role.current = 'VIEWER'
    renderPage()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(tableProps().onSuggest).toBeUndefined()
  })

  /** The entry of the actions menu, if offered. */
  const translateButtons = () => {
    const entry = actionItem('Mit KI übersetzen')
    return entry ? [entry] : []
  }

  it('MEMBER mit aktiver KI und zwei Sprachen: „Mit KI übersetzen“ öffnet den Dialog', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(translateButtons()).toHaveLength(1)
    await user.click(translateButtons()[0])
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', {
        name: 'Fehlende Texte mit KI übersetzen',
      })
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent('„translation“')
  })

  it('KI nicht aktiv: kein „Mit KI übersetzen“', () => {
    ai.enabled = false
    renderPage()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(translateButtons()).toHaveLength(0)
  })

  it('VIEWER: kein „Mit KI übersetzen“', () => {
    role.current = 'VIEWER'
    renderPage()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(translateButtons()).toHaveLength(0)
  })

  it('nur eine Projektsprache: kein „Mit KI übersetzen“', () => {
    setHook({ project: { ...PROJECT, languages: ['de'] } })
    renderPage()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(translateButtons()).toHaveLength(0)
  })
})

describe('TranslationsPage – Sprachen verwalten', () => {
  const setProjectLanguages = vi.mocked(translationsApi.setProjectLanguages)
  const setBrandLanguages = vi.mocked(translationsApi.setBrandLanguages)

  beforeAll(async () => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    role.current = 'ADMIN'
    setHook()
  })

  /** The button of the empty state, otherwise the entry of the actions menu. */
  const manageButton = () =>
    screen.queryByRole('button', { name: 'Sprachen verwalten' }) ??
    actionItem('Sprachen verwalten')

  it('ADMIN öffnet über die Toolbar die Projektsprachen der Standard-Sicht', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(manageButton() as HTMLElement)
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'Sprachen des Projekts' })
    ).toBeInTheDocument()
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-language'))
    ).toEqual(['de', 'en'])
  })

  it('ohne Brands bietet der Dialog keine Ziel-Auswahl', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(manageButton() as HTMLElement)
    expect(
      within(screen.getByRole('dialog')).queryByRole('combobox', {
        name: 'Ziel',
      })
    ).toBeNull()
  })

  it('Ziel Brand im Dialog: bearbeitet die Sprachen der Brand', async () => {
    const user = userEvent.setup()
    setBrandLanguages.mockResolvedValue({
      languages: ['de', 'en'],
      removedValues: 0,
    })
    setHook({ project: { ...PROJECT, type: 'MULTI' }, brands: [BRAND] })
    renderPage()
    await user.click(manageButton() as HTMLElement)
    const dialog = screen.getByRole('dialog')
    const target = within(dialog).getByRole('combobox', { name: 'Ziel' })
    expect(target).toHaveTextContent('Standard')
    await user.click(target)
    await user.click(await screen.findByRole('option', { name: 'Premium' }))
    expect(
      within(dialog).getByRole('heading', {
        name: 'Sprachen der Brand „Premium“',
      })
    ).toBeInTheDocument()
    // Project languages not yet offered by the brand are suggested.
    await user.click(
      within(dialog).getByRole('button', { name: 'en hinzufügen' })
    )
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(setBrandLanguages).toHaveBeenCalledWith('b1', ['de', 'en'], ['de'])
    )
    expect(setProjectLanguages).not.toHaveBeenCalled()
  })

  it('Zielwechsel ist gesperrt, sobald der Entwurf geändert ist; erneutes Öffnen beginnt beim Standard', async () => {
    const user = userEvent.setup()
    setHook({ project: { ...PROJECT, type: 'MULTI' }, brands: [BRAND] })
    renderPage()
    await user.click(manageButton() as HTMLElement)
    const target = () =>
      within(screen.getByRole('dialog')).getByRole('combobox', {
        name: 'Ziel',
      })
    await user.click(target())
    await user.click(await screen.findByRole('option', { name: 'Premium' }))
    expect(target()).toHaveTextContent('Premium')
    await user.type(screen.getByLabelText('Sprachcode'), 'fr{Enter}')
    expect(target()).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await user.click(manageButton() as HTMLElement)
    expect(target()).toHaveTextContent('Standard')
    expect(
      within(screen.getByRole('dialog')).getByRole('heading', {
        name: 'Sprachen des Projekts',
      })
    ).toBeInTheDocument()
  })

  it('MEMBER und VIEWER sehen keinen „Sprachen verwalten“-Button', () => {
    role.current = 'MEMBER'
    const { unmount } = renderPage()
    expect(manageButton()).not.toBeInTheDocument()
    unmount()
    role.current = 'VIEWER'
    renderPage()
    expect(manageButton()).not.toBeInTheDocument()
  })

  it('nach Speichern lädt die Seite die Tabelle neu', async () => {
    const user = userEvent.setup()
    setProjectLanguages.mockResolvedValue({
      languages: ['de', 'en', 'fr'],
      removedValues: 0,
    })
    renderPage()
    await user.click(manageButton() as HTMLElement)
    await user.type(screen.getByLabelText('Sprachcode'), 'fr{Enter}')
    expect(hook().reload).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(setProjectLanguages).toHaveBeenCalledWith(
        'p1',
        ['de', 'en', 'fr'],
        ['de', 'en']
      )
    )
    await waitFor(() => expect(hook().reload).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })

  it('der Button im Hinweis „keine Sprachen“ öffnet den Dialog', async () => {
    const user = userEvent.setup()
    setHook({
      project: { ...PROJECT, languages: [] },
      table: table({ languages: [], rows: [], total: 0 }),
    })
    renderPage()
    // Only the empty state offers the action; the actions menu does not repeat it.
    expect(
      screen.getAllByRole('button', { name: 'Sprachen verwalten' })
    ).toHaveLength(1)
    expect(actionItem('Sprachen verwalten')).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await user.click(manageButton() as HTMLElement)
    expect(
      within(screen.getByRole('dialog')).getByRole('heading', {
        name: 'Sprachen des Projekts',
      })
    ).toBeInTheDocument()
  })

  it('Speichern und sofort wieder öffnen beginnt mit der neuen Liste', async () => {
    const user = userEvent.setup()
    const reloaded = deferred<void>()
    setHook({ reload: vi.fn(() => reloaded.promise) })
    setProjectLanguages.mockResolvedValue({
      languages: ['de', 'en', 'fr'],
      removedValues: 0,
    })
    renderPage()
    await user.click(manageButton() as HTMLElement)
    await user.type(screen.getByLabelText('Sprachcode'), 'fr{Enter}')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    // Until the reload has landed the old list must not be reopened.
    expect(manageButton()).toHaveAttribute('aria-disabled', 'true')
    await act(async () => {
      notify({ project: { ...PROJECT, languages: ['de', 'en', 'fr'] } })
      reloaded.resolve()
    })
    expect(manageButton()).not.toHaveAttribute('aria-disabled')
    await user.click(manageButton() as HTMLElement)
    expect(
      within(screen.getByRole('dialog'))
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-language'))
    ).toEqual(['de', 'en', 'fr'])
  })

  it('bei einem Konflikt lädt die Seite die Sprachen neu', async () => {
    const user = userEvent.setup()
    setProjectLanguages.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: {} },
    })
    renderPage()
    await user.click(manageButton() as HTMLElement)
    await user.type(screen.getByLabelText('Sprachcode'), 'fr{Enter}')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(hook().reload).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('TranslationsPage – JSON-Import', () => {
  const previewImport = vi.mocked(translationsApi.previewImport)
  const applyImport = vi.mocked(translationsApi.applyImport)
  const RESULT = {
    added: ['a'],
    changed: [],
    unchanged: [],
    newKeys: ['a'],
    skipped: [],
  }

  beforeAll(async () => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    role.current = 'MEMBER'
    setHook()
    previewImport.mockResolvedValue(RESULT)
    applyImport.mockResolvedValue(RESULT)
  })

  /** The button of the empty state plus the entry of the actions menu. */
  const importButtons = () => {
    const entry = actionItem('JSON importieren')
    return [
      ...screen.queryAllByRole('button', { name: 'JSON importieren' }),
      ...(entry ? [entry] : []),
    ]
  }

  it('MEMBER importiert über die Toolbar in die gewählte Brand, danach lädt die Seite neu', async () => {
    const user = userEvent.setup()
    setHook({
      project: { ...PROJECT, type: 'MULTI' },
      brands: [{ ...BRAND, languages: ['de', 'en'] }],
    })
    renderPage()
    expect(importButtons()).toHaveLength(1)
    await user.click(importButtons()[0])
    const dialog = screen.getByRole('dialog')
    const target = within(dialog).getByRole('group', { name: 'Ziel' })
    expect(within(target).getByText('translation')).toBeInTheDocument()
    const targetSelect = within(dialog).getByRole('combobox', { name: 'Ziel' })
    expect(targetSelect).toHaveTextContent('Standard')
    await user.click(targetSelect)
    await user.click(await screen.findByRole('option', { name: 'Premium' }))
    await user.upload(
      within(dialog).getByLabelText('JSON-Datei'),
      new File(['{"a":"A"}'], 'translation.en.json', {
        type: 'application/json',
      })
    )
    await within(dialog).findByText('translation.en.json')
    await user.click(within(dialog).getByRole('button', { name: 'Vorschau' }))
    await user.click(
      await within(dialog).findByRole('button', { name: 'Importieren' })
    )
    const expected = {
      language: 'en',
      namespace: 'translation',
      brandId: 'b1',
    }
    await waitFor(() => expect(hook().reload).toHaveBeenCalledTimes(1))
    expect(previewImport).toHaveBeenCalledWith('p1', expected, { a: 'A' })
    expect(applyImport).toHaveBeenCalledWith('p1', expected, { a: 'A' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })

  it('VIEWER sieht keinen Import-Button', () => {
    role.current = 'VIEWER'
    renderPage()
    expect(importButtons()).toHaveLength(0)
  })

  it('der Button im Hinweis „keine Keys“ öffnet den Import; die Toolbar wiederholt ihn nicht', async () => {
    const user = userEvent.setup()
    setHook({ table: table({ rows: [], total: 0 }) })
    renderPage()
    expect(importButtons()).toHaveLength(1)
    await user.click(importButtons()[0])
    expect(
      within(screen.getByRole('dialog')).getByRole('heading', {
        name: 'JSON importieren',
      })
    ).toBeInTheDocument()
  })

  it('gesperrt, solange die Tabelle zu einer anderen Ansicht gehört', () => {
    const own = hook().tableScope
    act(() =>
      notify({
        tableScope: scopeOf({ ...hook().selection, namespace: 'other' }),
      })
    )
    renderPage()
    expect(importButtons()[0]).toHaveAttribute('aria-disabled', 'true')
    act(() => notify({ tableScope: own }))
    expect(importButtons()[0]).toBeEnabled()
  })

  it('auch im Hinweis „keine Keys“ gesperrt, solange die Tabelle fremd ist', () => {
    setHook({ table: table({ rows: [], total: 0 }) })
    act(() =>
      notify({
        tableScope: scopeOf({ ...hook().selection, namespace: 'other' }),
      })
    )
    renderPage()
    expect(importButtons()).toHaveLength(1)
    expect(importButtons()[0]).toBeDisabled()
  })
})
