const PLACEHOLDER_PATTERN =
  /\{\{[^{}]*\}\}|\$t\([^()]*\)|<\/?[A-Za-z0-9]+(?:\s[^<>]*?)?\/?>/g

/** All placeholders of a text, in order: `{{…}}`, `$t(…)`, opening, closing and self-closing tags. */
export function extractPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER_PATTERN) ?? []
}

/** True when both texts contain exactly the same placeholders (as a multiset, order ignored). */
export function samePlaceholders(source: string, translation: string): boolean {
  const a = extractPlaceholders(source).sort()
  const b = extractPlaceholders(translation).sort()
  return a.length === b.length && a.every((value, i) => value === b[i])
}
