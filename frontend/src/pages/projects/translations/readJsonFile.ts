/** Largest file the import accepts; mirrors the server's body limit. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

export type ReadJsonResult =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; error: 'too_large' | 'not_json' | 'not_object' }

const BOM = '﻿'

/**
 * Reads an i18next JSON file. A file over the limit is rejected without
 * being read. The parsed object is returned as is: flattening and checking
 * the keys is the server's job, and the object is never merged into another
 * one (it may legitimately hold keys such as `__proto__`).
 */
export function readJsonFile(file: File): Promise<ReadJsonResult> {
  if (file.size > MAX_IMPORT_BYTES)
    return Promise.resolve({ ok: false, error: 'too_large' })
  return file.text().then(parse, unreadable)
}

/** The browser could not read the file (e.g. removed meanwhile). */
const unreadable = (): ReadJsonResult => ({ ok: false, error: 'not_json' })

function parse(text: string): ReadJsonResult {
  let value: unknown
  try {
    value = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text)
  } catch {
    return { ok: false, error: 'not_json' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, error: 'not_object' }
  return { ok: true, content: value as Record<string, unknown> }
}
