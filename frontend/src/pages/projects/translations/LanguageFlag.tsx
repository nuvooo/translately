import 'flag-icons/css/flag-icons.min.css'
import { cn } from '@/lib/utils'
import { flagOf } from './languageCatalog'

/**
 * The flag that stands for a language code; renders nothing for a code
 * without a known flag. Decorative: the code or name next to it carries the
 * meaning, so it is hidden from assistive technology.
 */
export function LanguageFlag({
  language,
  className,
}: {
  language: string
  className?: string
}) {
  const country = flagOf(language)
  if (!country) return null
  return (
    <span
      data-flag={country}
      aria-hidden="true"
      className={cn(
        `fi fi-${country}`,
        'inline-block shrink-0 rounded-[2px] ring-1 ring-border',
        className
      )}
    />
  )
}
