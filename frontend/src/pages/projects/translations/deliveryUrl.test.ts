import { afterEach, describe, expect, it, vi } from 'vitest'
import { backendOrigin, deliveryLoadPath, i18nextSnippet } from './deliveryUrl'

describe('deliveryLoadPath', () => {
  it('builds the delivery path with i18next placeholders and no environment segment', () => {
    expect(deliveryLoadPath('https://h', 'shop')).toBe(
      'https://h/sdk/translations/shop/{{lng}}/{{ns}}'
    )
  })

  it('appends the brand key as query', () => {
    expect(deliveryLoadPath('https://h', 'shop', 'premium')).toBe(
      'https://h/sdk/translations/shop/{{lng}}/{{ns}}?brandKey=premium'
    )
  })

  it('strips a trailing slash of the origin', () => {
    expect(deliveryLoadPath('https://h/', 'shop')).toBe(
      'https://h/sdk/translations/shop/{{lng}}/{{ns}}'
    )
  })

  it('encodes project and brand keys but not the placeholders', () => {
    expect(deliveryLoadPath('https://h', 'a b/c', 'ü&z')).toBe(
      'https://h/sdk/translations/a%20b%2Fc/{{lng}}/{{ns}}?brandKey=%C3%BC%26z'
    )
  })
})

describe('i18nextSnippet', () => {
  const loadPath = 'https://h/sdk/translations/shop/{{lng}}/{{ns}}'

  it('produces the documented setup text', () => {
    expect(i18nextSnippet(loadPath, ['de', 'en'])).toBe(
      [
        "import i18next from 'i18next'",
        "import HttpBackend from 'i18next-http-backend'",
        '',
        'i18next.use(HttpBackend).init({',
        "  fallbackLng: 'de',",
        '  backend: {',
        `    loadPath: '${loadPath}',`,
        "    customHeaders: { 'x-api-key': '<YOUR_API_KEY>' },",
        '  },',
        '})',
      ].join('\n')
    )
  })

  it('falls back to en without languages', () => {
    expect(i18nextSnippet(loadPath, [])).toContain("fallbackLng: 'en',")
  })

  it('escapes quotes and backslashes so the snippet stays valid JavaScript', () => {
    const snippet = i18nextSnippet(String.raw`https://h/sdk/it's/a\b`, ["d'e"])
    expect(snippet).toContain(String.raw`loadPath: 'https://h/sdk/it\'s/a\\b',`)
    expect(snippet).toContain(String.raw`fallbackLng: 'd\'e',`)
  })
})

describe('backendOrigin', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the origin of an absolute VITE_API_URL', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com/api')
    expect(backendOrigin()).toBe('https://api.example.com')
  })

  it('uses the page origin for a relative or missing VITE_API_URL', () => {
    vi.stubEnv('VITE_API_URL', '/api')
    expect(backendOrigin()).toBe(window.location.origin)
    vi.stubEnv('VITE_API_URL', '')
    expect(backendOrigin()).toBe(window.location.origin)
  })
})
