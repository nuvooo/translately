import { describe, expect, it } from 'vitest'
import {
  LANGUAGE_PATTERN,
  similarLanguage,
  validateLanguage,
} from './languages'

describe('LANGUAGE_PATTERN', () => {
  it('is identical to the backend rule', () => {
    expect(LANGUAGE_PATTERN.source).toBe('^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
  })
})

describe('validateLanguage', () => {
  it("'de_DE' → invalid", () => {
    expect(validateLanguage('de_DE', [])).toBe('invalid')
  })

  it('rejects empty and malformed codes', () => {
    expect(validateLanguage('', [])).toBe('invalid')
    expect(validateLanguage('   ', [])).toBe('invalid')
    expect(validateLanguage('d', [])).toBe('invalid')
    expect(validateLanguage('deut', [])).toBe('invalid')
    expect(validateLanguage('de-', [])).toBe('invalid')
  })

  it('an existing code → duplicate', () => {
    expect(validateLanguage('de', ['de', 'en'])).toBe('duplicate')
    expect(validateLanguage('  en ', ['de', 'en'])).toBe('duplicate')
  })

  it("'pt-BR' → null", () => {
    expect(validateLanguage('pt-BR', ['de'])).toBeNull()
    expect(validateLanguage('zh-Hant-TW', [])).toBeNull()
  })

  it('compares case-sensitively (DE and de are different codes)', () => {
    expect(validateLanguage('DE', ['de'])).toBeNull()
  })
})

describe('similarLanguage', () => {
  it('names an existing code that differs only by case', () => {
    expect(similarLanguage('en-us', ['de', 'en-US'])).toBe('en-US')
    expect(similarLanguage(' DE ', ['de'])).toBe('de')
  })

  it('is null for exact duplicates and unrelated codes', () => {
    expect(similarLanguage('de', ['de'])).toBeNull()
    expect(similarLanguage('fr', ['de'])).toBeNull()
  })
})
