import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/axios', () => ({ default: { get: vi.fn() } }))

import {
  aiSourceLanguage,
  brandCell,
  EMPTY_CELL,
  ownBrandCount,
  withOverride,
} from './translationsState'
import type { TableRow, TranslationTable } from './types'

function row(
  values: Record<string, string | null>,
  overrides: Record<string, Record<string, string>> = {}
): TableRow {
  return {
    keyId: 'k1',
    key: 'greeting',
    description: null,
    locked: false,
    values: Object.fromEntries(
      Object.entries(values).map(([lng, value]) => [
        lng,
        { value, inherited: false },
      ])
    ),
    overrides,
  }
}

function table(rows: TableRow[]): TranslationTable {
  return {
    languages: ['de', 'en', 'fr'],
    namespaces: ['translation'],
    rows,
    total: rows.length,
    page: 1,
    pageSize: 50,
  }
}

const ALPHA = { id: 'b1', languages: ['de', 'fr'] }
const PROJECT_LANGUAGES = ['de', 'en']

describe('brandCell', () => {
  it('is null for a language the brand does not offer', () => {
    const r = row({ de: 'Hallo', en: 'Hello' })
    expect(brandCell(r, ALPHA, 'en', PROJECT_LANGUAGES)).toBeNull()
  })

  it('shows the brand’s own text as not inherited', () => {
    const r = row({ de: 'Hallo' }, { b1: { de: 'Servus' } })
    expect(brandCell(r, ALPHA, 'de', PROJECT_LANGUAGES)).toEqual({
      value: 'Servus',
      inherited: false,
    })
  })

  it('inherits the standard text of a project language', () => {
    const r = row({ de: 'Hallo' }, { b2: { de: 'Other brand' } })
    expect(brandCell(r, ALPHA, 'de', PROJECT_LANGUAGES)).toEqual({
      value: 'Hallo',
      inherited: true,
    })
  })

  it('is empty without own text and without a standard text to inherit', () => {
    // fr is offered by the brand only; de has no standard text
    const r = row({ de: null, fr: 'ignored' })
    expect(brandCell(r, ALPHA, 'fr', PROJECT_LANGUAGES)).toEqual(EMPTY_CELL)
    expect(brandCell(r, ALPHA, 'de', PROJECT_LANGUAGES)).toEqual(EMPTY_CELL)
  })
})

describe('ownBrandCount', () => {
  it('counts brands with at least one own text', () => {
    const r = row({}, { b1: { de: 'A' }, b2: { en: 'B', de: 'C' } })
    expect(ownBrandCount(r, [{ id: 'b1' }, { id: 'b2' }])).toBe(2)
  })

  it('does not count a brand with an empty object', () => {
    const r = row({}, { b1: {}, b2: { en: 'B' } })
    expect(ownBrandCount(r, [{ id: 'b1' }, { id: 'b2' }])).toBe(1)
  })

  it('ignores ids that are not in brands', () => {
    const r = row({}, { gone: { de: 'A' }, b1: { de: 'B' } })
    expect(ownBrandCount(r, [{ id: 'b1' }])).toBe(1)
  })
})

describe('withOverride', () => {
  it('sets an override', () => {
    const t = table([row({ de: 'Hallo' }, { b2: { en: 'X' } })])
    const next = withOverride(t, 'k1', 'b1', 'de', 'Servus')
    expect(next).not.toBe(t)
    expect(next.rows[0].overrides).toEqual({
      b1: { de: 'Servus' },
      b2: { en: 'X' },
    })
    expect(next.rows[0].values).toBe(t.rows[0].values)
    expect(t.rows[0].overrides).toEqual({ b2: { en: 'X' } })
  })

  it('removes an override and drops the brand when nothing is left', () => {
    const t = table([row({}, { b1: { de: 'Servus', en: 'Hi' } })])
    const once = withOverride(t, 'k1', 'b1', 'de', null)
    expect(once.rows[0].overrides).toEqual({ b1: { en: 'Hi' } })
    const twice = withOverride(once, 'k1', 'b1', 'en', null)
    expect(twice.rows[0].overrides).toEqual({})
  })

  it('returns the same table when nothing changes', () => {
    const t = table([row({}, { b1: { de: 'Servus' } })])
    expect(withOverride(t, 'k1', 'b1', 'de', 'Servus')).toBe(t)
    expect(withOverride(t, 'k1', 'b1', 'en', null)).toBe(t)
    expect(withOverride(t, 'k1', 'b2', 'de', null)).toBe(t)
    expect(withOverride(t, 'missing', 'b1', 'de', 'x')).toBe(t)
  })
})

describe('aiSourceLanguage', () => {
  const projectLanguages = ['de', 'en', 'fr']
  const brand = { id: 'b1', languages: ['fr', 'de', 'en'] }

  it('erste Projektsprache mit Standardtext, nie die Zielsprache', () => {
    const r = row({ de: 'Hallo', en: null, fr: 'Salut' })
    expect(aiSourceLanguage(r, 'en', projectLanguages)).toBe('de')
    expect(aiSourceLanguage(r, 'de', projectLanguages)).toBe('fr')
    expect(aiSourceLanguage(row({ de: '' }), 'en', projectLanguages)).toBeNull()
    expect(aiSourceLanguage(row({}), 'en', projectLanguages)).toBeNull()
  })

  it('Brand: eigene Texte der Brand zuerst, sonst Standardtexte', () => {
    const r = row({ de: 'Hallo', en: 'Hello' }, { b1: { en: 'Hi there' } })
    expect(aiSourceLanguage(r, 'fr', projectLanguages, brand)).toBe('en')
    expect(aiSourceLanguage(r, 'en', projectLanguages, brand)).toBe('de')
  })
})
