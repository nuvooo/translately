export interface TableCell {
  value: string | null
  inherited: boolean
}

export interface TableRow {
  keyId: string
  key: string
  description: string | null
  /** A locked key can neither be renamed nor deleted until it is unlocked. */
  locked: boolean
  /** Standard texts per language (`inherited` is always false here). */
  values: Record<string, TableCell>
  /** Own texts per brand id and language; a brand without an entry inherits. */
  overrides: Record<string, Record<string, string>>
}

export interface TranslationTable {
  languages: string[]
  namespaces: string[]
  rows: TableRow[]
  total: number
  page: number
  pageSize: number
}

export interface TableQuery {
  namespace?: string
  search?: string
  missingOnly?: boolean
  page?: number
  pageSize?: number
}

/** An AI translation of one key, not saved yet. */
export interface AiSuggestion {
  keyId: string
  value: string
  /** The placeholders differ from those of the source text. */
  placeholderMismatch: boolean
}

/** AI translations of the missing standard texts of one language, not saved yet. */
export interface AiPreviewLanguage {
  language: string
  /** Missing texts beyond the requested limit. */
  remaining: number
  suggestions: {
    keyId: string
    key: string
    source: string
    value: string
    placeholderMismatch: boolean
  }[]
}

export type SkipReason =
  | 'not_string'
  | 'empty'
  | 'invalid_key'
  | 'too_long'
  | 'conflict'

export interface ImportTarget {
  language: string
  namespace?: string
  brandId?: string
}

export interface ImportPreview {
  added: string[]
  changed: string[]
  unchanged: string[]
  newKeys: string[]
  skipped: { key: string; reason: SkipReason }[]
}
