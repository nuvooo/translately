/** Language code rule of the server (case-sensitive, stored as entered). */
export const LANGUAGE_PATTERN: RegExp = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** Most languages one list (project or brand) may hold. */
export const MAX_LANGUAGES = 100

/**
 * Checks a code before it is added to `existing`. The code is trimmed;
 * comparison is exact (`de` and `DE` are different codes).
 */
export function validateLanguage(
  code: string,
  existing: string[]
): 'invalid' | 'duplicate' | null {
  const trimmed = code.trim()
  if (!LANGUAGE_PATTERN.test(trimmed)) return 'invalid'
  if (existing.includes(trimmed)) return 'duplicate'
  return null
}

/**
 * An entry of `existing` that differs from `code` only by case (a likely
 * typo such as `en-us` next to `en-US`), or null.
 */
export function similarLanguage(
  code: string,
  existing: string[]
): string | null {
  const trimmed = code.trim()
  if (trimmed === '' || existing.includes(trimmed)) return null
  const lower = trimmed.toLowerCase()
  return existing.find((language) => language.toLowerCase() === lower) ?? null
}
