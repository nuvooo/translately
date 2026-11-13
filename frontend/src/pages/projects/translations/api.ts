import api from '@/lib/axios'
import type {
  AiPreviewLanguage,
  AiSuggestion,
  ImportPreview,
  ImportTarget,
  TableCell,
  TableQuery,
  TranslationTable,
} from './types'

interface KeyRef {
  id: string
  namespace: string
  key: string
}

interface LanguagesResult {
  languages: string[]
  removedValues: number
}

const enc = encodeURIComponent

/** Drops fields that are undefined or empty strings so they never reach the query. */
function compact<T extends object>(source: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || value === '') continue
    out[name as keyof T] = value
  }
  return out
}

export async function fetchTable(
  projectId: string,
  query: TableQuery
): Promise<TranslationTable> {
  const params = compact({
    ...query,
    missingOnly: query.missingOnly ? true : undefined,
  })
  const res = await api.get<TranslationTable>(
    `/projects/${enc(projectId)}/translations`,
    { params }
  )
  return res.data
}

export async function createKey(
  projectId: string,
  body: { namespace?: string; key: string; description?: string }
): Promise<KeyRef> {
  const res = await api.post<{ key: KeyRef }>(
    `/projects/${enc(projectId)}/translation-keys`,
    body
  )
  return res.data.key
}

export async function updateKey(
  keyId: string,
  body: { key?: string; description?: string | null }
): Promise<KeyRef> {
  const res = await api.patch<{ key: KeyRef }>(
    `/translation-keys/${enc(keyId)}`,
    body
  )
  return res.data.key
}

/** A locked key can neither be renamed nor deleted. */
export async function setKeyLocked(
  keyId: string,
  locked: boolean
): Promise<void> {
  await api.put(`/translation-keys/${enc(keyId)}/lock`, { locked })
}

export async function deleteKey(keyId: string): Promise<void> {
  await api.delete(`/translation-keys/${enc(keyId)}`)
}

/** For a brand, `value: ''` removes its override (the cell then inherits). */
export async function setValue(
  keyId: string,
  body: { language: string; brandId?: string; value: string }
): Promise<TableCell> {
  const res = await api.put<{ cell: TableCell }>(
    `/translation-keys/${enc(keyId)}/value`,
    body
  )
  return res.data.cell
}

/** Gives the brand its own text: a copy of the standard text. */
export async function unlinkValue(
  keyId: string,
  brandId: string,
  language: string
): Promise<TableCell> {
  const res = await api.post<{ cell: TableCell }>(
    `/translation-keys/${enc(keyId)}/brands/${enc(brandId)}/unlink`,
    { language }
  )
  return res.data.cell
}

/** Drops the brand's own text: the cell inherits the standard text again. */
export async function linkValue(
  keyId: string,
  brandId: string,
  language: string
): Promise<TableCell> {
  const res = await api.post<{ cell: TableCell }>(
    `/translation-keys/${enc(keyId)}/brands/${enc(brandId)}/link`,
    { language }
  )
  return res.data.cell
}

/**
 * `expected` is the list the client started from: the server then only
 * writes while the stored list still equals it (409 otherwise).
 */
export async function setProjectLanguages(
  projectId: string,
  languages: string[],
  expected?: string[]
): Promise<LanguagesResult> {
  const res = await api.put<LanguagesResult>(
    `/projects/${enc(projectId)}/languages`,
    expected === undefined ? { languages } : { languages, expected }
  )
  return res.data
}

export async function setBrandLanguages(
  brandId: string,
  languages: string[],
  expected?: string[]
): Promise<LanguagesResult> {
  const res = await api.put<LanguagesResult>(
    `/brands/${enc(brandId)}/languages`,
    expected === undefined ? { languages } : { languages, expected }
  )
  return res.data
}

export async function addNamespace(
  projectId: string,
  namespace: string
): Promise<{ namespaces: string[] }> {
  const res = await api.post<{ namespaces: string[] }>(
    `/projects/${enc(projectId)}/namespaces`,
    { namespace }
  )
  return res.data
}

export async function removeNamespace(
  projectId: string,
  namespace: string
): Promise<{ namespaces: string[]; removedKeys: number }> {
  const res = await api.delete<{ namespaces: string[]; removedKeys: number }>(
    `/projects/${enc(projectId)}/namespaces/${enc(namespace)}`
  )
  return res.data
}

export async function previewImport(
  projectId: string,
  target: ImportTarget,
  content: unknown
): Promise<ImportPreview> {
  const res = await api.post<ImportPreview>(
    `/projects/${enc(projectId)}/translations/import/preview`,
    { ...compact(target), content }
  )
  return res.data
}

export async function applyImport(
  projectId: string,
  target: ImportTarget,
  content: unknown
): Promise<ImportPreview> {
  const res = await api.post<ImportPreview>(
    `/projects/${enc(projectId)}/translations/import`,
    { ...compact(target), content }
  )
  return res.data
}

export async function exportFile(
  projectId: string,
  target: ImportTarget
): Promise<Blob> {
  const res = await api.get<Blob>(
    `/projects/${enc(projectId)}/translations/export`,
    { params: compact(target), responseType: 'blob' }
  )
  return res.data
}

/** Whether this instance has AI translation set up. */
export async function fetchAiStatus(): Promise<{ enabled: boolean }> {
  const res = await api.get<{ enabled: boolean }>('/ai-translation/status')
  return res.data
}

/** AI suggestions for keys; nothing is saved. */
export async function suggestTranslations(
  projectId: string,
  body: {
    sourceLanguage: string
    targetLanguage: string
    keyIds: string[]
    brandId?: string
  }
): Promise<{
  suggestions: AiSuggestion[]
  skipped: { keyId: string; reason: 'no_source' }[]
}> {
  const res = await api.post<{
    suggestions: AiSuggestion[]
    skipped: { keyId: string; reason: 'no_source' }[]
  }>(`/projects/${enc(projectId)}/translations/ai/suggest`, body)
  return res.data
}

/** AI suggestions for the missing standard texts of a namespace; nothing is saved. */
export async function previewMissingTranslations(
  projectId: string,
  body: {
    namespace?: string
    sourceLanguage: string
    targetLanguages: string[]
    limit?: number
  }
): Promise<{ languages: AiPreviewLanguage[] }> {
  const res = await api.post<{ languages: AiPreviewLanguage[] }>(
    `/projects/${enc(projectId)}/translations/ai/preview-missing`,
    body
  )
  return res.data
}

/** Saves confirmed AI texts; existing texts are never overwritten. */
export async function applyAiTranslations(
  projectId: string,
  body: {
    targetLanguage: string
    brandId?: string
    values: { keyId: string; value: string }[]
  }
): Promise<{ written: number; skippedExisting: number }> {
  const res = await api.post<{ written: number; skippedExisting: number }>(
    `/projects/${enc(projectId)}/translations/ai/apply`,
    body
  )
  return res.data
}
