import { isValidKey, LANGUAGE_PATTERN } from './limits'

describe('translation limits', () => {
  it.each(['a', 'checkout.button.submit', 'item_one', 'Hello world', 'x'.repeat(256)])(
    'akzeptiert %s',
    (k) => {
      expect(isValidKey(k)).toBe(true)
    }
  )

  it.each([
    '',
    '.a',
    'a.',
    'a..b',
    'a.__proto__.b',
    'constructor',
    'a.prototype.b',
    'a.constructor',
    'a\nb',
    'a\tb',
    'a\u0000b',
    'a\u007fb',
    'x'.repeat(257),
  ])('lehnt %j ab', (k) => {
    expect(isValidKey(k)).toBe(false)
  })

  it('LANGUAGE_PATTERN', () => {
    for (const ok of ['de', 'en', 'pt-BR', 'zh-Hant-TW'])
      expect(LANGUAGE_PATTERN.test(ok)).toBe(true)
    for (const bad of ['', 'd', 'de_DE', '../x', 'de-'])
      expect(LANGUAGE_PATTERN.test(bad)).toBe(false)
  })
})
