/** Brand-Datei: Standardtexte, überlagert von den Überschreibungen. */
export function mergeBrandFile(
  defaults: Record<string, string>,
  overrides: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = Object.create(null)
  for (const key of Object.keys(defaults)) result[key] = defaults[key]
  for (const key of Object.keys(overrides)) result[key] = overrides[key]
  return result
}
