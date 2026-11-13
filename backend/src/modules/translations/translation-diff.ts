export interface EntriesDiff {
  added: string[]
  changed: string[]
  unchanged: string[]
  targetOnly: string[]
}

const hasOwn = (obj: object, key: string): boolean =>
  Object.getOwnPropertyDescriptor(obj, key) !== undefined

/** Was passiert, wenn `source` additiv auf `target` angewendet wird. Alle Listen alphabetisch. */
export function diffEntries(
  source: Record<string, string>,
  target: Record<string, string>
): EntriesDiff {
  const added: string[] = []
  const changed: string[] = []
  const unchanged: string[] = []
  const targetOnly: string[] = []

  for (const key of Object.keys(source)) {
    if (!hasOwn(target, key)) added.push(key)
    else if (source[key] !== target[key]) changed.push(key)
    else unchanged.push(key)
  }
  for (const key of Object.keys(target)) {
    if (!hasOwn(source, key)) targetOnly.push(key)
  }
  return {
    added: added.sort(),
    changed: changed.sort(),
    unchanged: unchanged.sort(),
    targetOnly: targetOnly.sort(),
  }
}
