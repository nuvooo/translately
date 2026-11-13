import { computeSdkEtag, etagMatches } from './sdk-etag'
import { setSdkCorsHeaders } from './sdk-http.utils'

const S = { organizationId: 'org', projectId: 'p1' }

describe('computeSdkEtag', () => {
  const scope = { organizationId: 'o', projectId: 'p' }

  it('ändert sich mit der Version', () => {
    expect(computeSdkEtag(1, scope, ['de'])).not.toBe(
      computeSdkEtag(2, scope, ['de'])
    )
  })

  it('unterscheidet die Teile und ihre Reihenfolge', () => {
    expect(computeSdkEtag(1, scope, ['de', 'a'])).not.toBe(
      computeSdkEtag(1, scope, ['a', 'de'])
    )
  })

  it('hat die Form W/"<version>-<16 hex>"', () => {
    expect(computeSdkEtag(7, scope, [])).toMatch(/^W\/"7-[a-f0-9]{16}"$/)
  })

  it('lässt zusammengefügte Teile nicht mit getrennten kollidieren', () => {
    expect(computeSdkEtag(1, scope, ['de', 'a'])).not.toBe(
      computeSdkEtag(1, scope, ['de,a'])
    )
  })

  it('differs by organization and project', () => {
    const base = computeSdkEtag(1, S, [])
    expect(computeSdkEtag(1, { ...S, organizationId: 'org2' }, [])).not.toBe(
      base
    )
    expect(computeSdkEtag(1, { ...S, projectId: 'p2' }, [])).not.toBe(base)
  })
})

describe('etagMatches', () => {
  const etag = 'W/"3-0123456789abcdef"'

  it('matches exact, weak/strong variants, lists and *', () => {
    expect(etagMatches(etag, etag)).toBe(true)
    expect(etagMatches('"3-0123456789abcdef"', etag)).toBe(true)
    expect(etagMatches(`"x", ${etag}`, etag)).toBe(true)
    expect(etagMatches('*', etag)).toBe(true)
    expect(etagMatches([etag], etag)).toBe(true)
  })

  it('does not match other or missing values', () => {
    expect(etagMatches(undefined, etag)).toBe(false)
    expect(etagMatches('', etag)).toBe(false)
    expect(etagMatches('W/"2-0123456789abcdef"', etag)).toBe(false)
  })
})

describe('setSdkCorsHeaders', () => {
  it('exposes the ETag header to browsers', () => {
    const headers: Record<string, string> = {}
    setSdkCorsHeaders(
      { setHeader: (k, v) => (headers[k] = v) },
      'https://a.com'
    )
    expect(headers['Access-Control-Expose-Headers']).toContain('ETag')
    expect(headers['Access-Control-Allow-Headers']).toContain('If-None-Match')
  })
})
