/**
 * Languages offered in the languages dialog: ISO 639-1 codes plus the common
 * regional variants, each with the country whose flag stands for it. A flag
 * is only a visual hint (a language is not a country): the choice follows
 * what users of translation tools expect, e.g. `en` shows the British flag.
 * Any other valid code can still be typed in by hand.
 */
const CATALOG: readonly (readonly [code: string, country: string])[] = [
  ['af', 'za'],
  ['am', 'et'],
  ['ar', 'sa'],
  ['az', 'az'],
  ['be', 'by'],
  ['bg', 'bg'],
  ['bn', 'bd'],
  ['bs', 'ba'],
  ['ca', 'es-ct'],
  ['cs', 'cz'],
  ['cy', 'gb-wls'],
  ['da', 'dk'],
  ['de', 'de'],
  ['de-AT', 'at'],
  ['de-CH', 'ch'],
  ['el', 'gr'],
  ['en', 'gb'],
  ['en-AU', 'au'],
  ['en-CA', 'ca'],
  ['en-GB', 'gb'],
  ['en-US', 'us'],
  ['es', 'es'],
  ['es-AR', 'ar'],
  ['es-MX', 'mx'],
  ['et', 'ee'],
  ['eu', 'es-pv'],
  ['fa', 'ir'],
  ['fi', 'fi'],
  ['fil', 'ph'],
  ['fr', 'fr'],
  ['fr-BE', 'be'],
  ['fr-CA', 'ca'],
  ['fr-CH', 'ch'],
  ['ga', 'ie'],
  ['gl', 'es-ga'],
  ['gu', 'in'],
  ['he', 'il'],
  ['hi', 'in'],
  ['hr', 'hr'],
  ['hu', 'hu'],
  ['hy', 'am'],
  ['id', 'id'],
  ['is', 'is'],
  ['it', 'it'],
  ['it-CH', 'ch'],
  ['ja', 'jp'],
  ['ka', 'ge'],
  ['kk', 'kz'],
  ['km', 'kh'],
  ['kn', 'in'],
  ['ko', 'kr'],
  ['lb', 'lu'],
  ['lo', 'la'],
  ['lt', 'lt'],
  ['lv', 'lv'],
  ['mk', 'mk'],
  ['ml', 'in'],
  ['mn', 'mn'],
  ['mr', 'in'],
  ['ms', 'my'],
  ['mt', 'mt'],
  ['my', 'mm'],
  ['nb', 'no'],
  ['ne', 'np'],
  ['nl', 'nl'],
  ['nl-BE', 'be'],
  ['nn', 'no'],
  ['no', 'no'],
  ['pa', 'in'],
  ['pl', 'pl'],
  ['pt', 'pt'],
  ['pt-BR', 'br'],
  ['pt-PT', 'pt'],
  ['ro', 'ro'],
  ['ru', 'ru'],
  ['si', 'lk'],
  ['sk', 'sk'],
  ['sl', 'si'],
  ['sq', 'al'],
  ['sr', 'rs'],
  ['sv', 'se'],
  ['sw', 'tz'],
  ['ta', 'in'],
  ['te', 'in'],
  ['th', 'th'],
  ['tr', 'tr'],
  ['uk', 'ua'],
  ['ur', 'pk'],
  ['uz', 'uz'],
  ['vi', 'vn'],
  ['zh', 'cn'],
  ['zh-CN', 'cn'],
  ['zh-HK', 'hk'],
  ['zh-TW', 'tw'],
  ['zu', 'za'],
]

/** The codes of the catalog, sorted as listed above (by code). */
export const CATALOG_CODES: readonly string[] = CATALOG.map(([code]) => code)

const COUNTRY_OF = new Map(
  CATALOG.map(([code, country]) => [code.toLowerCase(), country])
)

/**
 * The flag (a `flag-icons` country code) for a language code, or null when
 * none is known. An exact catalog entry wins; otherwise a two-letter region
 * subtag (`es-CL` → `cl`), then the flag of the bare language (`de-x` → `de`).
 */
export function flagOf(language: string): string | null {
  const lower = language.trim().toLowerCase()
  const exact = COUNTRY_OF.get(lower)
  if (exact) return exact
  const [base, ...subtags] = lower.split('-')
  const region = subtags.find((part) => /^[a-z]{2}$/.test(part))
  if (region) return region
  return COUNTRY_OF.get(base) ?? null
}

/**
 * The name of a language in the UI language (`de` → "Deutsch", `pt-BR` →
 * "Portugiesisch (Brasilien)"), or null when the runtime knows none.
 */
export function languageName(
  language: string,
  uiLanguage: string
): string | null {
  try {
    const name = new Intl.DisplayNames([uiLanguage], {
      type: 'language',
      fallback: 'none',
    }).of(language.trim())
    return name ?? null
  } catch {
    // Not a well-formed tag for Intl, or no Intl.DisplayNames.
    return null
  }
}

export interface CatalogEntry {
  code: string
  /** Name in the UI language; the code when the runtime knows none. */
  name: string
}

/**
 * Catalog entries not in `existing` that match `query` by code prefix or by
 * a part of the name, both ignoring case; without a query all of them.
 * Sorted by name, with code-prefix matches first.
 */
export function searchCatalog(
  query: string,
  existing: readonly string[],
  uiLanguage: string
): CatalogEntry[] {
  const needle = query.trim().toLowerCase()
  const taken = new Set(existing)
  const collator = new Intl.Collator(uiLanguage)
  return CATALOG_CODES.filter((code) => !taken.has(code))
    .map((code) => ({ code, name: languageName(code, uiLanguage) ?? code }))
    .filter(
      (entry) =>
        needle === '' ||
        entry.code.toLowerCase().startsWith(needle) ||
        entry.name.toLowerCase().includes(needle)
    )
    .sort((a, b) => {
      if (needle !== '') {
        const aCode = a.code.toLowerCase().startsWith(needle)
        const bCode = b.code.toLowerCase().startsWith(needle)
        if (aCode !== bCode) return aCode ? -1 : 1
      }
      return collator.compare(a.name, b.name)
    })
}
