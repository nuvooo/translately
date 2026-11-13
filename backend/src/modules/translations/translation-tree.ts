import { isValidKey, MAX_KEY_LENGTH, MAX_VALUE_LENGTH } from './limits'

export type SkipReason =
  | 'not_string'
  | 'empty'
  | 'invalid_key'
  | 'too_long'
  | 'conflict'
export interface SkippedEntry {
  key: string
  reason: SkipReason
}
export interface FlattenResult {
  entries: Record<string, string>
  skipped: SkippedEntry[]
}

const hasOwn = (obj: object, key: string): boolean =>
  Object.getOwnPropertyDescriptor(obj, key) !== undefined

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Alle echten Eltern-Pfade eines Keys: 'a.b.c' -> ['a', 'a.b']. */
function properPrefixes(key: string): string[] {
  const result: string[] = []
  let index = key.indexOf('.')
  while (index !== -1) {
    result.push(key.slice(0, index))
    index = key.indexOf('.', index + 1)
  }
  return result
}

interface Frame {
  source: Record<string, unknown>
  keys: string[]
  position: number
  prefix: string | null
}

/** Verschachteltes oder flaches i18next-JSON → flache Keys in Punkt-Notation. */
export function flattenTree(input: unknown): FlattenResult {
  const entries: Record<string, string> = Object.create(null)
  const skipped: SkippedEntry[] = []
  if (!isObject(input)) return { entries, skipped }

  const acceptedKeys = new Set<string>()
  const acceptedPrefixes = new Set<string>()
  const skip = (key: string, reason: SkipReason) =>
    skipped.push({
      key:
        key.length > MAX_KEY_LENGTH ? `${key.slice(0, MAX_KEY_LENGTH)}…` : key,
      reason,
    })

  // Explizierter Stack statt Rekursion: beliebig tiefe Eingaben sind unkritisch.
  const stack: Frame[] = [
    { source: input, keys: Object.keys(input), position: 0, prefix: null },
  ]
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    if (frame.position >= frame.keys.length) {
      stack.pop()
      continue
    }
    const segment = frame.keys[frame.position++]
    const value = frame.source[segment]
    const key = frame.prefix === null ? segment : `${frame.prefix}.${segment}`

    if (isObject(value)) {
      if (key.length > MAX_KEY_LENGTH) {
        // Jeder Blatt-Key darunter wäre ohnehin zu lang: nicht weiter absteigen.
        skip(key, 'invalid_key')
      } else {
        stack.push({
          source: value,
          keys: Object.keys(value),
          position: 0,
          prefix: key,
        })
      }
      continue
    }

    if (typeof value !== 'string') {
      skip(key, 'not_string')
    } else if (value === '') {
      skip(key, 'empty')
    } else if (!isValidKey(key)) {
      skip(key, 'invalid_key')
    } else if (value.length > MAX_VALUE_LENGTH) {
      skip(key, 'too_long')
    } else if (acceptedKeys.has(key) || acceptedPrefixes.has(key)) {
      skip(key, 'conflict')
    } else if (properPrefixes(key).some((p) => acceptedKeys.has(p))) {
      skip(key, 'conflict')
    } else {
      entries[key] = value
      acceptedKeys.add(key)
      for (const prefix of properPrefixes(key)) acceptedPrefixes.add(prefix)
    }
  }
  return { entries, skipped }
}

/** Flache Keys → verschachteltes Objekt. Konflikte (a und a.b): das Blatt `a` gewinnt, `a.b` entfällt. Wirft nie. */
export function buildTree(
  entries: Record<string, string>
): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  if (!isObject(entries)) return root

  const validKeys = Object.keys(entries).filter(
    (key) => isValidKey(key) && typeof entries[key] === 'string'
  )
  const keySet = new Set(validKeys)

  for (const key of validKeys) {
    // Hat der Key ein Blatt als Elternteil, entfällt er (unabhängig von der Reihenfolge).
    if (properPrefixes(key).some((p) => keySet.has(p))) continue

    const segments = key.split('.')
    let node = root
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      let next = hasOwn(node, segment) ? node[segment] : undefined
      if (!isObject(next)) {
        next = {}
        Object.defineProperty(node, segment, {
          value: next,
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
      node = next as Record<string, unknown>
    }
    Object.defineProperty(node, segments[segments.length - 1], {
      value: entries[key],
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return root
}

export interface KeyConflict {
  key: string
  conflictsWith: string
}

/**
 * Wie `findKeyConflict`, aber für alle Kandidaten in einem linearen Durchlauf:
 * Kandidaten, die mit einem vorhandenen oder früher akzeptierten Key als
 * Blatt/Eltern kollidieren, landen in `conflicts`, alle anderen (Reihenfolge
 * bleibt) in `accepted`. Gleichheit ist kein Konflikt.
 */
export function findKeyConflicts(
  candidates: string[],
  existing: string[]
): { accepted: string[]; conflicts: KeyConflict[] } {
  const keys = new Set<string>()
  // Eltern-Pfad -> erster bekannter Key darunter
  const parents = new Map<string, string>()
  const register = (key: string) => {
    keys.add(key)
    for (const prefix of properPrefixes(key)) {
      if (!parents.has(prefix)) parents.set(prefix, key)
    }
  }
  for (const key of existing) register(key)

  const accepted: string[] = []
  const conflicts: KeyConflict[] = []
  for (const candidate of candidates) {
    const leafAbove = properPrefixes(candidate).find((p) => keys.has(p))
    const below = parents.get(candidate)
    if (leafAbove !== undefined) {
      conflicts.push({ key: candidate, conflictsWith: leafAbove })
    } else if (below !== undefined) {
      conflicts.push({ key: candidate, conflictsWith: below })
    } else {
      accepted.push(candidate)
      register(candidate)
    }
  }
  return { accepted, conflicts }
}

/** Erster Key aus `candidates`, der mit einem Key aus `existing` oder einem anderen Kandidaten als Blatt/Eltern kollidiert. */
export function findKeyConflict(
  candidates: string[],
  existing: string[]
): { key: string; conflictsWith: string } | null {
  const keys = new Set<string>()
  // Eltern-Pfad -> erster bekannter Key darunter
  const parents = new Map<string, string>()

  const register = (key: string) => {
    keys.add(key)
    for (const prefix of properPrefixes(key)) {
      if (!parents.has(prefix)) parents.set(prefix, key)
    }
  }

  for (const key of existing) register(key)

  for (const candidate of candidates) {
    for (const prefix of properPrefixes(candidate)) {
      if (keys.has(prefix)) return { key: candidate, conflictsWith: prefix }
    }
    const below = parents.get(candidate)
    if (below !== undefined) return { key: candidate, conflictsWith: below }
    register(candidate)
  }
  return null
}
