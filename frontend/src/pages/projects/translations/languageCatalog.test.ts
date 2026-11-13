import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_CODES,
  flagOf,
  languageName,
  searchCatalog,
} from './languageCatalog'
import { LANGUAGE_PATTERN } from './languages'

describe('languageCatalog', () => {
  it('lists only codes the server accepts, each once', () => {
    expect(CATALOG_CODES.length).toBeGreaterThan(80)
    expect(new Set(CATALOG_CODES).size).toBe(CATALOG_CODES.length)
    for (const code of CATALOG_CODES) expect(code).toMatch(LANGUAGE_PATTERN)
  })

  it('has a flag file for every catalog code', () => {
    const flags = resolve(process.cwd(), 'node_modules/flag-icons/flags/4x3')
    for (const code of CATALOG_CODES) {
      const flag = flagOf(code)
      expect(flag, code).not.toBeNull()
      expect(
        existsSync(resolve(flags, `${flag}.svg`)),
        `${code} → ${flag}`
      ).toBe(true)
    }
  })

  it('names every catalog code in German and English', () => {
    for (const code of CATALOG_CODES) {
      expect(languageName(code, 'de'), code).toBeTruthy()
      expect(languageName(code, 'en'), code).toBeTruthy()
    }
  })

  describe('flagOf', () => {
    it.each([
      ['de', 'de'],
      ['en', 'gb'],
      ['en-US', 'us'],
      ['pt-BR', 'br'],
      ['ja', 'jp'],
      // region subtag of a variant that is not in the catalog
      ['es-CL', 'cl'],
      ['zh-Hant-TW', 'tw'],
      // case does not matter
      ['EN-us', 'us'],
      // no region: the flag of the bare language
      ['de-1996', 'de'],
    ])('%s → %s', (code, flag) => {
      expect(flagOf(code)).toBe(flag)
    })

    it('knows no flag for an unknown language', () => {
      expect(flagOf('tlh')).toBeNull()
      expect(flagOf('')).toBeNull()
    })
  })

  describe('languageName', () => {
    it('names a language in the UI language', () => {
      expect(languageName('de', 'de')).toBe('Deutsch')
      expect(languageName('de', 'en')).toBe('German')
      expect(languageName('pt-BR', 'de')).toBe('Portugiesisch (Brasilien)')
    })

    it('returns null for something that is not a language tag', () => {
      expect(languageName('not a tag', 'de')).toBeNull()
      expect(languageName('', 'de')).toBeNull()
    })
  })

  describe('searchCatalog', () => {
    const codes = (query: string, existing: string[] = []) =>
      searchCatalog(query, existing, 'de').map((entry) => entry.code)

    it('without a query lists everything not taken yet, sorted by name', () => {
      const all = searchCatalog('', ['de', 'en'], 'de')
      expect(all).toHaveLength(CATALOG_CODES.length - 2)
      expect(all.map((entry) => entry.code)).not.toContain('de')
      const names = all.map((entry) => entry.name)
      expect(names).toEqual([...names].sort(new Intl.Collator('de').compare))
    })

    it('matches by a part of the name, ignoring case', () => {
      expect(codes('FRANZ')).toEqual(['fr', 'fr-BE', 'fr-CA', 'fr-CH'])
    })

    it('matches by code prefix and lists those first', () => {
      const found = codes('pl')
      expect(found[0]).toBe('pl')
      expect(codes('pt-')).toEqual(['pt-BR', 'pt-PT'])
    })

    it('finds nothing for an unknown text', () => {
      expect(codes('xyzxyz')).toEqual([])
    })
  })
})
