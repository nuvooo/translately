import api from '@/lib/axios'
import { getErrorStatus } from '@/lib/errors'
import type { TableCell, TableQuery, TableRow, TranslationTable } from './types'
import type { TranslationsSelection } from './useTranslations'

/** Pure helpers of `useTranslations`: selection rules, queries, structure fetch. */

export interface TranslationsProject {
  id: string
  key: string
  type: 'SINGLE' | 'MULTI'
  languages: string[]
  namespaces: string[]
}
export interface TranslationsBrand {
  id: string
  key: string
  name: string
  languages: string[]
}
export interface Structure {
  project: TranslationsProject
  brands: TranslationsBrand[]
}
export type LoadError = 'not-found' | 'failed' | null

export const DEFAULT_NAMESPACE = 'translation'
export const EMPTY_CELL: TableCell = { value: null, inherited: false }

export const startNamespace = (namespaces: string[]) =>
  namespaces.includes(DEFAULT_NAMESPACE)
    ? DEFAULT_NAMESPACE
    : (namespaces[0] ?? DEFAULT_NAMESPACE)

export function startSelection(
  structure: Structure | null
): TranslationsSelection {
  return {
    namespace: startNamespace(structure?.project.namespaces ?? []),
    search: '',
    missingOnly: false,
    page: 1,
  }
}

/** Keeps the selection where still valid; a fallback starts on page 1 again. */
export function revalidate(
  selection: TranslationsSelection,
  structure: Structure
): TranslationsSelection {
  if (structure.project.namespaces.includes(selection.namespace))
    return selection
  const { namespace } = startSelection(structure)
  return { ...selection, namespace, page: 1 }
}

export function toQuery(selection: TranslationsSelection): TableQuery {
  const search = selection.search.trim()
  const query: TableQuery = { namespace: selection.namespace }
  if (search) query.search = search
  if (selection.missingOnly) query.missingOnly = true
  query.page = selection.page
  return query
}

/** The part of the selection the cells of a loaded table belong to. */
export const viewOf = (s: TranslationsSelection) =>
  [s.namespace, s.page].join('|')

export function withCell(
  table: TranslationTable,
  keyId: string,
  language: string,
  cell: TableCell
): TranslationTable {
  // Same object when nothing would change: no needless identity change.
  const target = table.rows.find((r) => r.keyId === keyId)
  if (!target || !table.languages.includes(language)) return table
  const current = target.values[language]
  if (current?.value === cell.value && current.inherited === cell.inherited)
    return table
  return {
    ...table,
    rows: table.rows.map((r) =>
      r === target ? { ...r, values: { ...r.values, [language]: cell } } : r
    ),
  }
}

/** Cell of a brand row; null = the brand does not offer the language. */
export function brandCell(
  row: TableRow,
  brand: { id: string; languages: string[] },
  language: string,
  projectLanguages: string[]
): TableCell | null {
  if (!brand.languages.includes(language)) return null
  const own = row.overrides[brand.id]?.[language]
  if (own !== undefined) return { value: own, inherited: false }
  const standard = row.values[language]?.value
  if (projectLanguages.includes(language) && standard)
    return { value: standard, inherited: true }
  return EMPTY_CELL
}

/**
 * Source language of an AI suggestion for `target`: for a brand cell first a
 * language with the brand's own text, then the first project language with a
 * standard text; never `target` itself. null = nothing to translate from.
 */
export function aiSourceLanguage(
  row: TableRow,
  target: string,
  projectLanguages: string[],
  brand?: { id: string; languages: string[] }
): string | null {
  const own = brand ? row.overrides[brand.id] : undefined
  const fromBrand = brand?.languages.find((l) => l !== target && own?.[l])
  if (fromBrand) return fromBrand
  return (
    projectLanguages.find((l) => l !== target && row.values[l]?.value) ?? null
  )
}

/** Number of brands (from `brands`) with at least one own text in this row. */
export function ownBrandCount(row: TableRow, brands: { id: string }[]): number {
  return brands.filter((b) => Object.keys(row.overrides[b.id] ?? {}).length > 0)
    .length
}

/** Sets (string) or removes (null) an override; same table when nothing changes. */
export function withOverride(
  table: TranslationTable,
  keyId: string,
  brandId: string,
  language: string,
  value: string | null
): TranslationTable {
  const target = table.rows.find((r) => r.keyId === keyId)
  if (!target) return table
  const current = target.overrides[brandId]?.[language]
  if ((current ?? null) === value) return table
  const { [brandId]: own = {}, ...others } = target.overrides
  const { [language]: _removed, ...rest } = own
  const texts = value === null ? rest : { ...rest, [language]: value }
  const overrides =
    Object.keys(texts).length > 0 ? { ...others, [brandId]: texts } : others
  return {
    ...table,
    rows: table.rows.map((r) => (r === target ? { ...r, overrides } : r)),
  }
}

/**
 * Writes a cell of the standard texts (`brandId` null) or of a brand. For a
 * brand an inherited or empty cell means: no override.
 */
export function withScopedCell(
  table: TranslationTable,
  keyId: string,
  language: string,
  brandId: string | null,
  cell: TableCell
): TranslationTable {
  if (!brandId) return withCell(table, keyId, language, cell)
  const own = cell.inherited || !cell.value ? null : cell.value
  return withOverride(table, keyId, brandId, language, own)
}

export async function fetchStructure(projectId: string): Promise<Structure> {
  const projectRes = await api.get(`/projects/${projectId}`)
  const raw = projectRes.data.project
  const project: TranslationsProject = {
    id: raw.id,
    key: raw.key,
    type: raw.type,
    languages: raw.languages ?? [],
    namespaces: raw.namespaces ?? [],
  }
  let brands: TranslationsBrand[] = []
  if (project.type === 'MULTI') {
    const brandsRes = await api.get(`/brands/project/${projectId}`)
    brands = (brandsRes.data.brands ?? []).map((b: TranslationsBrand) => ({
      id: b.id,
      key: b.key,
      name: b.name,
      languages: b.languages ?? [],
    }))
  }
  return { project, brands }
}

export const loadError = (error: unknown): LoadError =>
  getErrorStatus(error) === 404 ? 'not-found' : 'failed'

/**
 * The namespace: the scope texts are read from and saved to (standard texts
 * and brand overrides alike). Page, search and the missing-only flag are not
 * part of it.
 */
export const scopeOf = (s: TranslationsSelection) => s.namespace

/**
 * The table together with what it was loaded for, kept as ONE state value so
 * no render can see rows next to the scope of other rows. `scope` and `view`
 * are those of the selection the request was started with.
 */
export interface LoadedTable {
  table: TranslationTable | null
  /** `scopeOf` of the request; null without a table. */
  scope: string | null
  /** `viewOf` of the request (scope and page); null without a table. */
  view: string | null
}
export const NO_TABLE: LoadedTable = { table: null, scope: null, view: null }

/**
 * Saves in flight for one cell. `latest` is the newest save's number;
 * `confirmed` is the cell the server confirmed last (by save order), seeded
 * from the table when the first save starts.
 */
export interface CellSaves {
  latest: number
  latestSettled: boolean
  inFlight: number
  confirmed: TableCell
  confirmedSeq: number
}
