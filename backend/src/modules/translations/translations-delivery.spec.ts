import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { SDK_ERROR_CODES } from '../sdk/sdk.constants'
import {
  DeliveryDeps,
  handleTranslationsRequest,
  TRANSLATIONS_ROUTE,
} from './translations-delivery'

const project = {
  id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  organizationId: 'cccccccccccccccccccccccc',
  type: 'MULTI',
  languages: ['de', 'en'],
  namespaces: ['translation', 'common'],
}

function createRes() {
  const headers: Record<string, string> = {}
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
    ended: false,
    headers,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value
    }),
    removeHeader: jest.fn((name: string) => {
      delete headers[name]
    }),
    status: jest.fn((code: number) => {
      res.statusCode = code
      return res
    }),
    json: jest.fn((body: unknown) => {
      res.body = body
      res.ended = true
      return res
    }),
    end: jest.fn(() => {
      res.ended = true
      return res
    }),
  }
  return res
}

function createDeps(version = 1) {
  const deps = {
    sdkService: {
      resolveSdkAccess: jest.fn().mockResolvedValue({
        organizationId: project.organizationId,
        apiKeyId: 'key-id',
        project,
      }),
      resolveBrandId: jest.fn().mockResolvedValue(null),
    },
    files: {
      getFile: jest.fn().mockResolvedValue({
        'checkout.submit': 'Jetzt kaufen',
        'checkout.cancel': 'Abbrechen',
        title: 'Shop',
      }),
    },
    changeEvents: { getVersion: jest.fn().mockResolvedValue(version) },
    logger: { debug: jest.fn(), error: jest.fn() },
  }
  return deps as typeof deps & DeliveryDeps
}

interface FakeReq {
  params: Record<string, string>
  query: Record<string, unknown>
  headers: Record<string, string | string[] | undefined>
}

function createReq(overrides: Partial<FakeReq> = {}): FakeReq {
  return {
    params: {
      projectKey: 'shop',
      lng: 'de',
      ns: 'translation',
      ...overrides.params,
    },
    query: overrides.query ?? {},
    headers: { 'x-api-key': 'secret', ...overrides.headers },
  }
}

async function run(deps: DeliveryDeps, req: FakeReq): Promise<any> {
  const res = createRes()
  await handleTranslationsRequest(deps, req, res)
  return res
}

describe('handleTranslationsRequest', () => {
  it('exposes the i18next http backend route', () => {
    expect(TRANSLATIONS_ROUTE).toBe('/sdk/translations/:projectKey/:lng/:ns')
  })

  it('answers 401 with MISSING_API_KEY without an API key', async () => {
    const deps = createDeps()
    const req = createReq()
    req.headers = {}

    const res = await run(deps, req)

    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe(SDK_ERROR_CODES.missingApiKey)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(deps.sdkService.resolveSdkAccess).not.toHaveBeenCalled()
    expect(deps.files.getFile).not.toHaveBeenCalled()
  })

  it('serves the file as nested JSON with ETag and Cache-Control', async () => {
    const deps = createDeps()

    const res = await run(deps, createReq())

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      checkout: { submit: 'Jetzt kaufen', cancel: 'Abbrechen' },
      title: 'Shop',
    })
    expect(res.headers.ETag).toMatch(/^W\/"1-[a-f0-9]{16}"$/)
    expect(res.headers['Cache-Control']).toBe('private, no-cache')
    expect(res.headers.Vary).toBe('Origin, X-API-Key, Authorization')
    expect(deps.sdkService.resolveSdkAccess).toHaveBeenCalledWith(
      'shop',
      'secret',
      undefined
    )
    expect(deps.changeEvents.getVersion).toHaveBeenCalledWith(project.id)
    expect(deps.files.getFile).toHaveBeenCalledWith({
      project,
      namespace: 'translation',
      language: 'de',
      brandId: null,
    })
  })

  it('passes the origin to resolveSdkAccess and reflects it in CORS', async () => {
    const deps = createDeps()

    const res = await run(
      deps,
      createReq({ headers: { origin: 'https://shop.example' } })
    )

    expect(deps.sdkService.resolveSdkAccess).toHaveBeenCalledWith(
      'shop',
      'secret',
      'https://shop.example'
    )
    expect(res.headers['Access-Control-Allow-Origin']).toBe(
      'https://shop.example'
    )
  })

  it("strips '.json' from ns before calling getFile", async () => {
    const deps = createDeps()

    const res = await run(deps, createReq({ params: { ns: 'common.json' } }))

    expect(res.statusCode).toBe(200)
    expect(deps.files.getFile).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'common' })
    )
  })

  it('answers 304 without body when If-None-Match is the current ETag', async () => {
    const deps = createDeps()
    const first = await run(deps, createReq())
    deps.files.getFile.mockClear()
    deps.sdkService.resolveBrandId.mockClear()

    const res = await run(
      deps,
      createReq({ headers: { 'if-none-match': first.headers.ETag } })
    )

    expect(res.statusCode).toBe(304)
    expect(res.end).toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
    expect(res.headers.ETag).toBe(first.headers.ETag)
    expect(deps.files.getFile).not.toHaveBeenCalled()
    expect(deps.sdkService.resolveBrandId).not.toHaveBeenCalled()
  })

  it('declares only the project-level route without an environment segment', () => {
    expect(TRANSLATIONS_ROUTE.split('/').filter(Boolean)).toHaveLength(5)
    expect(TRANSLATIONS_ROUTE).not.toContain('environmentKey')
  })

  it('serves the brand file when the brand resolves and {} when it has no such language', async () => {
    const deps = createDeps()
    deps.sdkService.resolveBrandId.mockResolvedValue('brand-id')
    deps.files.getFile.mockImplementation(async ({ language, brandId }: any) =>
      brandId === 'brand-id' && language === 'de'
        ? { title: 'Brand Shop', 'checkout.submit': 'Jetzt kaufen' }
        : {}
    )

    const de = await run(deps, createReq({ query: { brandKey: 'acme' } }))
    const en = await run(
      deps,
      createReq({ params: { lng: 'en' }, query: { brandKey: 'acme' } })
    )

    expect(de.body).toEqual({
      title: 'Brand Shop',
      checkout: { submit: 'Jetzt kaufen' },
    })
    expect(en.statusCode).toBe(200)
    expect(en.body).toEqual({})
  })

  it('issues a new ETag after recordChange bumped the project version', async () => {
    const deps = createDeps(1)
    const first = await run(deps, createReq())
    deps.changeEvents.getVersion.mockResolvedValue(2)

    const res = await run(
      deps,
      createReq({ headers: { 'if-none-match': first.headers.ETag } })
    )

    expect(res.statusCode).toBe(200)
    expect(res.headers.ETag).not.toBe(first.headers.ETag)
  })

  it('changes the ETag when the version increases', async () => {
    const before = await run(createDeps(1), createReq())
    const after = await run(createDeps(2), createReq())

    expect(after.headers.ETag).not.toBe(before.headers.ETag)
  })

  it('serves the new file after a version increase despite the old ETag', async () => {
    const before = await run(createDeps(1), createReq())
    const deps = createDeps(2)

    const res = await run(
      deps,
      createReq({ headers: { 'if-none-match': before.headers.ETag } })
    )

    expect(res.statusCode).toBe(200)
    expect(deps.files.getFile).toHaveBeenCalled()
  })

  it('uses a different ETag for another language or brand', async () => {
    const base = await run(createDeps(), createReq())
    const otherLanguage = await run(
      createDeps(),
      createReq({ params: { lng: 'en' } })
    )
    const otherNamespace = await run(
      createDeps(),
      createReq({ params: { ns: 'common' } })
    )
    const brand = await run(
      createDeps(),
      createReq({ query: { brandKey: 'acme' } })
    )
    const otherBrand = await run(
      createDeps(),
      createReq({ query: { brandKey: 'globex' } })
    )

    const etags = [base, otherLanguage, otherNamespace, brand, otherBrand].map(
      (res) => res.headers.ETag
    )
    expect(new Set(etags).size).toBe(5)
  })

  it.each([
    ['../etc', 'translation'],
    ['de', '../secrets'],
    ['de', 'unknown'],
    ['de', 'a.b'],
  ])('answers 200 {} for lng=%s ns=%s without getFile', async (lng, ns) => {
    const deps = createDeps()

    const res = await run(deps, createReq({ params: { lng, ns } }))

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({})
    expect(res.headers.ETag).toBeUndefined()
    expect(res.headers['Cache-Control']).toBe('private, no-cache')
    expect(deps.files.getFile).not.toHaveBeenCalled()
    expect(deps.changeEvents.getVersion).not.toHaveBeenCalled()
  })

  it('passes a well-formed language the project does not have to getFile', async () => {
    const deps = createDeps()
    deps.files.getFile.mockResolvedValue({})

    const res = await run(deps, createReq({ params: { lng: 'pt-BR' } }))

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({})
    expect(deps.files.getFile).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'pt-BR' })
    )
  })

  it('authenticates before validating lng and ns', async () => {
    const deps = createDeps()
    deps.sdkService.resolveSdkAccess.mockRejectedValue(
      new UnauthorizedException('Invalid API key')
    )

    const res = await run(deps, createReq({ params: { lng: '../etc' } }))

    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe(SDK_ERROR_CODES.invalidApiKey)
  })

  it('answers 401 without ETag when resolveSdkAccess throws UnauthorizedException', async () => {
    const deps = createDeps()
    deps.sdkService.resolveSdkAccess.mockRejectedValue(
      new UnauthorizedException('Invalid API key')
    )

    const res = await run(deps, createReq())

    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe(SDK_ERROR_CODES.invalidApiKey)
    expect(res.headers.ETag).toBeUndefined()
    expect(deps.files.getFile).not.toHaveBeenCalled()
  })

  it('maps ForbiddenException to 403 and NotFoundException to 404', async () => {
    const forbidden = createDeps()
    forbidden.sdkService.resolveSdkAccess.mockRejectedValue(
      new ForbiddenException('Origin not allowed')
    )
    const notFound = createDeps()
    notFound.sdkService.resolveSdkAccess.mockRejectedValue(
      new NotFoundException('Project not found')
    )

    expect((await run(forbidden, createReq())).statusCode).toBe(403)
    expect((await run(notFound, createReq())).statusCode).toBe(404)
  })

  it('removes the ETag and answers 500 without internals when getFile fails', async () => {
    const deps = createDeps()
    deps.files.getFile.mockRejectedValue(new Error('Prisma: connection lost'))

    const res = await run(deps, createReq())

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({
      error: 'Internal error',
      code: SDK_ERROR_CODES.internalError,
    })
    expect(res.headers.ETag).toBeUndefined()
    expect(res.removeHeader).toHaveBeenCalledWith('ETag')
    expect(deps.logger.error).toHaveBeenCalled()
  })

  it('never rejects, even when the thrown value is not an Error', async () => {
    const deps = createDeps()
    deps.changeEvents.getVersion.mockRejectedValue(undefined)

    const res = createRes()
    await expect(
      handleTranslationsRequest(deps, createReq(), res)
    ).resolves.toBeUndefined()
    expect(res.statusCode).toBe(500)
  })

  it('calls getFile with brandId null when resolveBrandId returns null', async () => {
    const deps = createDeps()

    await run(deps, createReq({ query: { brandKey: 'unknown' } }))

    expect(deps.sdkService.resolveBrandId).toHaveBeenCalledWith(
      project,
      'unknown'
    )
    expect(deps.files.getFile).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: null })
    )
  })

  it('passes the resolved brand id to getFile', async () => {
    const deps = createDeps()
    deps.sdkService.resolveBrandId.mockResolvedValue('brand-id')

    await run(deps, createReq({ query: { brandKey: 'acme' } }))

    expect(deps.files.getFile).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'brand-id' })
    )
  })

  it('handles an array-valued brandKey query without a 500', async () => {
    const deps = createDeps()

    const res = await run(deps, createReq({ query: { brandKey: ['a', 'b'] } }))

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(expect.any(Object))
    expect(deps.sdkService.resolveBrandId).toHaveBeenCalledWith(
      project,
      undefined
    )
  })

  it('handles an array-valued x-api-key header without a 500', async () => {
    const deps = createDeps()

    const res = await run(
      deps,
      createReq({ headers: { 'x-api-key': ['first', 'second'] } })
    )

    expect(res.statusCode).toBe(200)
    expect(deps.sdkService.resolveSdkAccess).toHaveBeenCalledWith(
      'shop',
      'first',
      undefined
    )
  })

  it('accepts the API key as ?apiKey= query parameter', async () => {
    const deps = createDeps()
    const req = createReq({ query: { apiKey: 'from-query' } })
    req.headers = {}

    const res = await run(deps, req)

    expect(res.statusCode).toBe(200)
    expect(deps.sdkService.resolveSdkAccess).toHaveBeenCalledWith(
      'shop',
      'from-query',
      undefined
    )
  })
})
