import {
  extractEffectiveBrandKey,
  extractSdkApiKey,
  extractSdkOrigin,
  mapSdkError,
} from './sdk-http.utils'

describe('sdk-http.utils', () => {
  describe('extractSdkApiKey', () => {
    it('prefers apiKey from query string', () => {
      const apiKey = extractSdkApiKey({
        headers: {
          authorization: 'Bearer bearer-key',
          'x-api-key': 'header-key',
        },
        query: {
          apiKey: 'query-key',
        },
      })

      expect(apiKey).toBe('query-key')
    })

    it('falls back to bearer token and x-api-key header', () => {
      expect(
        extractSdkApiKey({
          headers: { authorization: 'Bearer bearer-key' },
          query: {},
        })
      ).toBe('bearer-key')

      expect(
        extractSdkApiKey({
          headers: { 'x-api-key': 'header-key' },
          query: {},
        })
      ).toBe('header-key')
    })
  })

  describe('extractEffectiveBrandKey', () => {
    it('reads brandKey', () => {
      expect(extractEffectiveBrandKey({ brandKey: 'brand-a' })).toBe('brand-a')
    })

    it('has no tenantId alias', () => {
      expect(extractEffectiveBrandKey({ tenantId: 'tenant-a' })).toBeUndefined()
    })

    it('ignores non-string and empty values', () => {
      expect(extractEffectiveBrandKey({ brandKey: 42 })).toBeUndefined()
      expect(extractEffectiveBrandKey({ brandKey: '' })).toBeUndefined()
    })
  })

  describe('extractSdkOrigin', () => {
    it('returns the request origin header', () => {
      expect(
        extractSdkOrigin({
          headers: { origin: 'https://app.example.com' },
          query: {},
        })
      ).toBe('https://app.example.com')
    })
  })

  describe('mapSdkError', () => {
    it('maps auth/origin/not-found errors to stable response payloads', () => {
      expect(mapSdkError({ status: 401, message: 'Invalid API key' })).toEqual({
        status: 401,
        body: { error: 'Invalid API key', code: 'INVALID_API_KEY' },
      })

      expect(
        mapSdkError({ status: 403, message: 'Origin not allowed' })
      ).toEqual({
        status: 403,
        body: { error: 'Origin not allowed', code: 'ORIGIN_NOT_ALLOWED' },
      })

      expect(mapSdkError({ message: 'Project not found' })).toEqual({
        status: 404,
        body: { error: 'Project not found', code: 'PROJECT_NOT_FOUND' },
      })
    })

    it('returns a generic message for unexpected errors', () => {
      expect(mapSdkError({ message: 'Boom' })).toEqual({
        status: 500,
        body: { error: 'Internal error', code: 'INTERNAL_ERROR' },
      })
      expect(
        mapSdkError({
          message:
            'Invalid `prisma.brand.findFirst()` invocation: Malformed ObjectID',
        })
      ).toEqual({
        status: 500,
        body: { error: 'Internal error', code: 'INTERNAL_ERROR' },
      })
      expect(mapSdkError({} as any)).toEqual({
        status: 500,
        body: { error: 'Internal error', code: 'INTERNAL_ERROR' },
      })
    })

    it('uses fixed messages for auth/origin errors', () => {
      expect(
        mapSdkError({
          status: 401,
          message: 'API key does not have access to this project',
        })
      ).toEqual({
        status: 401,
        body: { error: 'Invalid API key', code: 'INVALID_API_KEY' },
      })
    })
  })
})
