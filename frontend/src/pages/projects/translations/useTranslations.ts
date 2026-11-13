import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { apiMessage, getErrorCode, getErrorStatus } from '@/lib/errors'
import { handleForbidden, notifyWriteError } from '@/lib/permissions'
import * as translationsApi from './api'
import {
  type CellSaves,
  EMPTY_CELL,
  fetchStructure,
  type LoadError,
  type LoadedTable,
  loadError,
  NO_TABLE,
  revalidate,
  type Structure,
  scopeOf,
  startSelection,
  type TranslationsBrand,
  type TranslationsProject,
  toQuery,
  viewOf,
  withScopedCell,
} from './translationsState'
import type { TableCell, TableRow, TranslationTable } from './types'

export interface TranslationsSelection {
  namespace: string
  search: string
  missingOnly: boolean
  page: number
}

const SEARCH_DELAY_MS = 300

/** Longest server detail appended to the key-conflict toast. */
const MAX_CONFLICT_DETAIL = 120

function keyConflictText(err: unknown, t: (key: string) => string): string {
  const text = t('translations.toast.key-conflict')
  const detail = apiMessage(err, '')
  return detail && detail.length <= MAX_CONFLICT_DETAIL
    ? `${text} (${detail})`
    : text
}

/** The server refused a rename or delete because the key is locked. */
function isKeyLocked(err: unknown): boolean {
  return getErrorStatus(err) === 409 && getErrorCode(err) === 'key_locked'
}

/** One cell: standard text (`brandId` omitted or null) or a brand's text. */
export function cellKey(
  keyId: string,
  language: string,
  brandId?: string | null
): string {
  return `${keyId}:${language}:${brandId ?? 'default'}`
}

/**
 * State and server calls of the translations page: project structure, the
 * selection above the table, the table itself and all cell/key mutations.
 * Every load carries a running number; responses of older loads are dropped.
 */
export function useTranslations(projectId: string | null): {
  project: {
    id: string
    key: string
    type: 'SINGLE' | 'MULTI'
    languages: string[]
    namespaces: string[]
  } | null
  brands: { id: string; key: string; name: string; languages: string[] }[]
  selection: TranslationsSelection
  select(patch: Partial<TranslationsSelection>): void
  table: TranslationTable | null
  /**
   * Scope (`scopeOf`: the namespace) the rows in `table` were
   * loaded for; null without a table. Differs from the selection's scope
   * while another scope is loading.
   */
  tableScope: string | null
  isLoading: boolean
  error: 'not-found' | 'failed' | null
  isBusy(cell: string): boolean
  saveValue(
    row: TableRow,
    language: string,
    value: string,
    brandId?: string | null
  ): Promise<boolean>
  unlink(row: TableRow, language: string, brandId: string): Promise<boolean>
  relink(row: TableRow, language: string, brandId: string): Promise<boolean>
  createKey(key: string, description?: string): Promise<boolean>
  renameKey(row: TableRow, key: string): Promise<boolean>
  deleteKey(row: TableRow): Promise<boolean>
  /** Locks or unlocks a key; a locked key cannot be renamed or deleted. */
  setKeyLocked(row: TableRow, locked: boolean): Promise<boolean>
  reload(): Promise<void>
} {
  const { t } = useTranslation()
  const tRef = useRef(t)
  tRef.current = t
  const [project, setProject] = useState<TranslationsProject | null>(null)
  const [brands, setBrands] = useState<TranslationsBrand[]>([])
  const [selection, setSelection] = useState(() => startSelection(null))
  // Table and the scope/view it was loaded for: one value, never out of sync.
  const [loaded, setLoaded] = useState<LoadedTable>(NO_TABLE)
  const { table, scope: tableScope } = loaded
  const [isLoading, setIsLoading] = useState(Boolean(projectId))
  const [error, setError] = useState<LoadError>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  const selectionRef = useRef(selection)
  /**
   * The rows on screen and their scope: follows `loaded` when a render is
   * committed, not when a response is applied or a render merely starts.
   */
  const shownRef = useRef(loaded)
  useLayoutEffect(() => {
    shownRef.current = loaded
  }, [loaded])
  const structureLoadId = useRef(0)
  const tableLoadId = useRef(0)
  /** Whether the project structure is there: the table only loads then. */
  const hasStructure = useRef(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mounted = useRef(true)
  /** Saves in flight per `scope|cellKey`; replaced on a project switch. */
  const saves = useRef(new Map<string, CellSaves>())
  const saveSeq = useRef(0)

  const applySelection = useCallback((next: TranslationsSelection) => {
    selectionRef.current = next
    setSelection(next)
  }, [])

  const loadTable = useCallback(
    async (sel: TranslationsSelection) => {
      clearTimeout(searchTimer.current)
      const id = ++tableLoadId.current
      if (!projectId || !hasStructure.current) {
        setLoaded(NO_TABLE)
        setError(null)
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      setError(null)
      // Fixed when the request starts: what the response will be rows of.
      const requested = { scope: scopeOf(sel), view: viewOf(sel) }
      try {
        const data = await translationsApi.fetchTable(projectId, toQuery(sel))
        if (id === tableLoadId.current) setLoaded({ table: data, ...requested })
      } catch (err) {
        if (id !== tableLoadId.current) return
        handleForbidden(err, tRef.current)
        setError('failed') // 'not-found' is only for the project itself
      } finally {
        if (id === tableLoadId.current) setIsLoading(false)
      }
    },
    [projectId]
  )

  /** Loads project and brands, then the table. */
  const loadAll = useCallback(
    async (keepSelection: boolean) => {
      const id = ++structureLoadId.current
      tableLoadId.current++ // drop table responses of the previous structure
      clearTimeout(searchTimer.current)
      if (!keepSelection) {
        hasStructure.current = false
        setProject(null)
        setBrands([])
        setLoaded(NO_TABLE)
        setBusy(new Set())
        saves.current = new Map()
        applySelection(startSelection(null))
      }
      if (!projectId) {
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      setError(null)
      let structure: Structure
      try {
        structure = await fetchStructure(projectId)
      } catch (err) {
        if (id !== structureLoadId.current) return
        handleForbidden(err, tRef.current)
        setError(loadError(err))
        setIsLoading(false)
        return
      }
      if (id !== structureLoadId.current) return
      hasStructure.current = true
      setProject(structure.project)
      setBrands(structure.brands)
      const next = keepSelection
        ? revalidate(selectionRef.current, structure)
        : startSelection(structure)
      applySelection(next)
      await loadTable(next)
    },
    [projectId, loadTable, applySelection]
  )

  useEffect(() => {
    mounted.current = true
    loadAll(false)
    return () => {
      mounted.current = false
      structureLoadId.current++
      tableLoadId.current++
      clearTimeout(searchTimer.current)
    }
  }, [loadAll])

  const select = useCallback(
    (patch: Partial<TranslationsSelection>) => {
      const prev = selectionRef.current
      const changed = (
        Object.keys(patch) as (keyof TranslationsSelection)[]
      ).filter((k) => patch[k] !== undefined && patch[k] !== prev[k])
      if (changed.length === 0) return
      const next = { ...prev }
      for (const k of changed) Object.assign(next, { [k]: patch[k] })
      if (changed.some((k) => k !== 'page') && patch.page === undefined)
        next.page = 1
      applySelection(next)
      if (changed.every((k) => k === 'search')) {
        clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(
          () => loadTable(selectionRef.current),
          SEARCH_DELAY_MS
        )
      } else {
        loadTable(next)
      }
    },
    [loadTable, applySelection]
  )

  /**
   * Writes one cell (standard text, or a brand's text when `brandId` is
   * set), but only while `view` is both the selected view and the view the
   * table was loaded for (after switching back to a view the rows of the
   * previous one may still be shown); otherwise the table object stays
   * untouched. The table's view is checked on the state the write applies
   * to, so a table response applied just before is taken into account.
   */
  const writeCell = useCallback(
    (
      view: string,
      keyId: string,
      language: string,
      brandId: string | null,
      cell: TableCell
    ) => {
      if (!mounted.current || view !== viewOf(selectionRef.current)) return
      setLoaded((prev) => {
        if (!prev.table || prev.view !== view) return prev
        const next = withScopedCell(prev.table, keyId, language, brandId, cell)
        return next === prev.table ? prev : { ...prev, table: next }
      })
    },
    []
  )

  const setBusyFlag = useCallback((key: string, on: boolean) => {
    if (!mounted.current) return
    setBusy((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  /**
   * Optimistic write of one cell (standard text, or a brand's text when
   * `brandId` is set): shows the `optimistic` cell at once, then what the
   * server answers to `request`. Overlapping writes of the same cell (saves,
   * unlink, relink) are ordered: only the newest one decides what is shown;
   * once it has settled, the cell shows what the server confirmed last.
   * Busy until all settled.
   *
   * Invariant: a request is only ever issued when the rows on screen were
   * loaded for the scope the request is sent to. While the rows shown belong
   * to another scope (a switch is still loading) nothing is sent, written or
   * reported and the result is `false`, whatever the caller does.
   *
   * `optimistic` gets the standard text of the row on screen; returning
   * null from it skips the write (no request, result `true`).
   */
  const writeValue = useCallback(
    async (
      row: TableRow,
      language: string,
      brandId: string | null,
      optimistic: (standard: string | null) => TableCell | null,
      request: () => Promise<TableCell>
    ) => {
      const sel = selectionRef.current
      const scope = scopeOf(sel)
      const onScreen = shownRef.current
      if (!onScreen.table || onScreen.scope !== scope) return false
      const view = viewOf(sel)
      const shown =
        onScreen.table.rows.find((r) => r.keyId === row.keyId) ?? row
      const standard = shown.values[language] ?? EMPTY_CELL
      const first = optimistic(standard.value)
      if (!first) return true
      const key = `${scope}|${cellKey(row.keyId, language, brandId)}`
      let entry = saves.current.get(key)
      if (!entry) {
        const own = brandId ? shown.overrides[brandId]?.[language] : undefined
        entry = {
          latest: 0,
          latestSettled: false,
          inFlight: 0,
          confirmed: !brandId
            ? standard
            : own === undefined
              ? EMPTY_CELL
              : { value: own, inherited: false },
          confirmedSeq: 0,
        }
        saves.current.set(key, entry)
        setBusyFlag(key, true)
      }
      const seq = ++saveSeq.current
      entry.latest = seq
      entry.latestSettled = false
      entry.inFlight++
      writeCell(view, row.keyId, language, brandId, first)
      let ok = true
      try {
        const cell = await request()
        if (seq > entry.confirmedSeq) {
          entry.confirmed = cell
          entry.confirmedSeq = seq
        }
      } catch (err) {
        ok = false
        notifyWriteError(
          err,
          tRef.current,
          tRef.current('translations.toast.save-failed')
        )
      }
      if (seq === entry.latest) entry.latestSettled = true
      if (entry.latestSettled)
        writeCell(view, row.keyId, language, brandId, entry.confirmed)
      entry.inFlight--
      if (entry.inFlight === 0 && saves.current.get(key) === entry) {
        saves.current.delete(key)
        setBusyFlag(key, false)
      }
      return ok
    },
    [writeCell, setBusyFlag]
  )

  /** For a brand, an empty `value` removes its override (it inherits). */
  const saveValue = useCallback(
    (row: TableRow, language: string, value: string, brandId?: string | null) =>
      writeValue(
        row,
        language,
        brandId ?? null,
        () => ({ value, inherited: false }),
        () =>
          translationsApi.setValue(row.keyId, {
            language,
            ...(brandId ? { brandId } : {}),
            value,
          })
      ),
    [writeValue]
  )

  /**
   * Gives the brand its own text, starting as a copy of the standard text.
   * Without a standard text there is nothing to copy: no request, `true`.
   */
  const unlink = useCallback(
    (row: TableRow, language: string, brandId: string) =>
      writeValue(
        row,
        language,
        brandId,
        (standard) => (standard ? { value: standard, inherited: false } : null),
        () => translationsApi.unlinkValue(row.keyId, brandId, language)
      ),
    [writeValue]
  )

  /** Drops the brand's own text: the cell inherits the standard text again. */
  const relink = useCallback(
    (row: TableRow, language: string, brandId: string) =>
      writeValue(
        row,
        language,
        brandId,
        (standard) => ({ value: standard, inherited: true }),
        () => translationsApi.linkValue(row.keyId, brandId, language)
      ),
    [writeValue]
  )

  /**
   * Runs a key mutation, then reloads the table unless the structure was
   * reloaded meanwhile (project switch, unmount). 409 (name taken or a
   * leaf/parent collision) shows a locale text, followed by the server's
   * detail (English, names the colliding key) only when it is short.
   */
  const keyWrite = useCallback(
    async (request: () => Promise<unknown>) => {
      const generation = structureLoadId.current
      try {
        await request()
      } catch (err) {
        if (isKeyLocked(err))
          toast.error(tRef.current('translations.toast.key-locked'))
        else if (getErrorStatus(err) === 409)
          toast.error(keyConflictText(err, tRef.current))
        else
          notifyWriteError(
            err,
            tRef.current,
            tRef.current('translations.toast.key-failed')
          )
        return false
      }
      if (generation === structureLoadId.current)
        await loadTable(selectionRef.current)
      return true
    },
    [loadTable]
  )

  const createKey = useCallback(
    async (key: string, description?: string) => {
      if (!projectId) return false
      const { namespace } = selectionRef.current
      return keyWrite(() =>
        translationsApi.createKey(projectId, {
          namespace,
          key,
          ...(description?.trim() ? { description } : {}),
        })
      )
    },
    [projectId, keyWrite]
  )

  const renameKey = useCallback(
    (row: TableRow, key: string) =>
      keyWrite(() => translationsApi.updateKey(row.keyId, { key })),
    [keyWrite]
  )

  const deleteKey = useCallback(
    async (row: TableRow) => {
      const generation = structureLoadId.current
      try {
        await translationsApi.deleteKey(row.keyId)
      } catch (err) {
        if (isKeyLocked(err)) {
          toast.error(tRef.current('translations.toast.key-locked'))
          // Someone else locked the key meanwhile: show the lock.
          if (generation === structureLoadId.current)
            await loadTable(selectionRef.current)
        } else
          notifyWriteError(
            err,
            tRef.current,
            tRef.current('translations.toast.delete-failed')
          )
        return false
      }
      if (generation !== structureLoadId.current) return true
      const sel = selectionRef.current
      const rows = shownRef.current.table?.rows ?? []
      const emptiedPage =
        sel.page > 1 && rows.length === 1 && rows[0].keyId === row.keyId
      const next = emptiedPage ? { ...sel, page: sel.page - 1 } : sel
      if (emptiedPage) applySelection(next)
      await loadTable(next)
      return true
    },
    [loadTable, applySelection]
  )

  const setKeyLocked = useCallback(
    async (row: TableRow, locked: boolean) => {
      const generation = structureLoadId.current
      try {
        await translationsApi.setKeyLocked(row.keyId, locked)
      } catch (err) {
        notifyWriteError(
          err,
          tRef.current,
          tRef.current('translations.toast.lock-failed')
        )
        return false
      }
      if (generation === structureLoadId.current)
        await loadTable(selectionRef.current)
      return true
    },
    [loadTable]
  )

  const scope = scopeOf(selection)
  const isBusy = useCallback(
    (cell: string) => busy.has(`${scope}|${cell}`),
    [busy, scope]
  )

  const reload = useCallback(() => loadAll(true), [loadAll])

  return {
    project,
    brands,
    selection,
    select,
    table,
    tableScope,
    isLoading,
    error,
    isBusy,
    saveValue,
    unlink,
    relink,
    createKey,
    renameKey,
    deleteKey,
    setKeyLocked,
    reload,
  }
}
