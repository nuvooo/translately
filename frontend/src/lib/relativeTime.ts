/** "3 hours ago" in the given locale; `null` for missing/invalid dates. */
export function formatRelative(
  date: string | undefined,
  locale: string,
  now: number = Date.now()
): string | null {
  if (!date) return null
  const time = new Date(date).getTime()
  if (Number.isNaN(time)) return null
  const seconds = Math.round((time - now) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return rtf.format(Math.round(seconds / size), unit)
    }
  }
  return rtf.format(0, 'second')
}
