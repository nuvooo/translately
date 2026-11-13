import { isOriginAllowed } from './sdk.helpers'

describe('sdk.helpers', () => {
  describe('isOriginAllowed', () => {
    it('supports exact, wildcard, and subdomain matches', () => {
      expect(
        isOriginAllowed('https://app.example.com', ['https://app.example.com'])
      ).toBe(true)
      expect(
        isOriginAllowed('https://foo.example.com', ['*.example.com'])
      ).toBe(true)
      expect(isOriginAllowed('https://anywhere.com', ['*'])).toBe(true)
      expect(
        isOriginAllowed('https://evil.com', ['https://app.example.com'])
      ).toBe(false)
    })

    it('does not match look-alike domains for wildcard entries', () => {
      expect(
        isOriginAllowed('https://evilexample.com', ['*.example.com'])
      ).toBe(false)
      expect(
        isOriginAllowed('https://example.com.evil.io', ['*.example.com'])
      ).toBe(false)
      expect(
        isOriginAllowed('https://evil.io/?x=.example.com', ['*.example.com'])
      ).toBe(false)
    })

    it('matches nested subdomains, the apex and is case-insensitive', () => {
      expect(
        isOriginAllowed('https://a.b.example.com', ['*.example.com'])
      ).toBe(true)
      expect(isOriginAllowed('https://example.com', ['*.example.com'])).toBe(
        true
      )
      expect(
        isOriginAllowed('https://APP.Example.com', ['*.example.com'])
      ).toBe(true)
      expect(
        isOriginAllowed('http://foo.example.com:8080', ['*.example.com'])
      ).toBe(true)
    })

    it('compares normalized origins for exact entries', () => {
      expect(
        isOriginAllowed('https://app.example.com', ['https://app.example.com/'])
      ).toBe(true)
      expect(
        isOriginAllowed('https://app.example.com:443', [
          'https://app.example.com',
        ])
      ).toBe(true)
      expect(
        isOriginAllowed('http://app.example.com', ['https://app.example.com'])
      ).toBe(false)
      expect(
        isOriginAllowed('https://app.example.com:8443', [
          'https://app.example.com',
        ])
      ).toBe(false)
    })

    it('rejects invalid or opaque origins unless "*" is allowed', () => {
      expect(isOriginAllowed('null', ['*.example.com'])).toBe(false)
      expect(isOriginAllowed('not a url', ['not a url'])).toBe(false)
      expect(isOriginAllowed('file:///etc/passwd', ['*.example.com'])).toBe(
        false
      )
      expect(isOriginAllowed('null', ['*'])).toBe(true)
    })
  })
})
