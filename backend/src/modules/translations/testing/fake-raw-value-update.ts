/**
 * In-memory stand-in for the raw MongoDB `update` command that
 * `writeValues` sends through `$runCommandRaw` (unit tests only). It is
 * strict about the encoding: ObjectId fields must be `{ $oid }` and dates
 * `{ $date }`, as the real server would otherwise compare an ObjectId with a
 * plain string and silently match nothing.
 */

export interface FakeValueRow {
  keyId: string
  projectId: string
  language: string
  scope: string
  value: string
  updatedById: string | null
  updatedAt?: string
}

const OBJECT_ID = /^[0-9a-f]{24}$/
const OBJECT_ID_FIELDS = new Set(['keyId', 'projectId', 'updatedById'])
const QUERY_FIELDS = ['keyId', 'projectId', 'language', 'scope']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objectId(value: unknown, field: string, index: number): string {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.$oid !== 'string' ||
    !OBJECT_ID.test(value.$oid)
  ) {
    throw new Error(`statement ${index}: ${field} must be { $oid: string }`)
  }
  return value.$oid
}

function date(value: unknown, field: string, index: number): string {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.$date !== 'string' ||
    Number.isNaN(Date.parse(value.$date))
  ) {
    throw new Error(`statement ${index}: ${field} must be { $date: string }`)
  }
  return value.$date
}

function plainString(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string') {
    throw new Error(`statement ${index}: ${field} must be a string`)
  }
  return value
}

/** Decodes one update statement or throws if its encoding is wrong. */
function decode(statement: any, index: number) {
  const q: Record<string, string> = {}
  if (!isPlainObject(statement?.q)) {
    throw new Error(`statement ${index}: q is missing`)
  }
  for (const field of Object.keys(statement.q)) {
    if (!QUERY_FIELDS.includes(field)) {
      throw new Error(`statement ${index}: unexpected query field ${field}`)
    }
  }
  for (const field of QUERY_FIELDS) {
    const value = statement.q[field]
    q[field] = OBJECT_ID_FIELDS.has(field)
      ? objectId(value, field, index)
      : plainString(value, field, index)
  }
  const set = statement?.u?.$set
  if (!isPlainObject(set)) {
    throw new Error(`statement ${index}: u.$set is missing`)
  }
  return {
    q,
    value: plainString(set.value, 'value', index),
    updatedById: objectId(set.updatedById, 'updatedById', index),
    updatedAt: date(set.updatedAt, 'updatedAt', index),
  }
}

/**
 * Applies `command` (`{ update: 'translation_values', updates: [...] }`) to
 * `rows` and answers like MongoDB (`{ ok: 1, n, nModified }`). Every
 * statement is validated before any row changes.
 */
export function applyRawValueUpdate(
  rows: FakeValueRow[],
  command: any
): { ok: 1; n: number; nModified: number } {
  if (command?.update !== 'translation_values') {
    throw new Error('unexpected collection')
  }
  if (!Array.isArray(command.updates)) throw new Error('updates is missing')
  const statements = command.updates.map(decode)
  const identity = (fields: Record<string, unknown>) =>
    QUERY_FIELDS.map((field) => fields[field]).join('|')
  const byIdentity = new Map<string, FakeValueRow>()
  for (const r of rows) {
    byIdentity.set(identity(r as unknown as Record<string, unknown>), r)
  }
  let n = 0
  for (const statement of statements) {
    const row = byIdentity.get(identity(statement.q))
    if (!row) continue
    n++
    row.value = statement.value
    row.updatedById = statement.updatedById
    row.updatedAt = statement.updatedAt
  }
  return { ok: 1, n, nModified: n }
}
