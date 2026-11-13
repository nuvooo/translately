import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { AccessService } from '../../shared/access/access.service'
import { AuthGuard } from '../../shared/auth.guard'
import { GlobalExceptionFilter } from '../../shared/filters/global-exception.filter'
import { registerImportBodyParser } from './import-body-parser'
import { MAX_IMPORT_BYTES } from './limits'
import { TranslationImportService } from './translation-import.service'
import { TranslationLinkService } from './translation-link.service'
import { TranslationSettingsService } from './translation-settings.service'
import { TranslationsController } from './translations.controller'
import { TranslationsService } from './translations.service'

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'

const preview = {
  added: ['a'],
  changed: [],
  unchanged: [],
  newKeys: ['a'],
  skipped: [],
}

/** A JSON body of roughly `bytes` bytes for the import routes. */
function importBody(bytes: number, extra: Record<string, unknown> = {}) {
  const content: Record<string, string> = {}
  const chunk = 'x'.repeat(1000)
  for (let i = 0; i * 1000 < bytes; i++) content[`k${i}`] = chunk
  return JSON.stringify({
    language: 'de',
    content,
    ...extra,
  })
}

/**
 * HTTP-level tests on a minimal Nest app that is bootstrapped like main.ts
 * (same pipe, filter, prefix and import body parser registration).
 */
describe('import routes over HTTP', () => {
  let app: INestApplication
  let baseUrl: string
  const imports = {
    preview: jest.fn(),
    apply: jest.fn(),
    exportFile: jest.fn(),
  }
  const translations = { createKey: jest.fn() }
  const access = {
    assertProjectAccess: jest.fn().mockResolvedValue({}),
    assertBrandInProject: jest.fn().mockResolvedValue({}),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TranslationsController],
      providers: [
        { provide: TranslationsService, useValue: translations },
        { provide: AccessService, useValue: access },
        { provide: TranslationSettingsService, useValue: {} },
        { provide: TranslationLinkService, useValue: {} },
        { provide: TranslationImportService, useValue: imports },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = { userId: USER_ID }
          return true
        },
      })
      .compile()

    app = moduleRef.createNestApplication({ logger: false })
    registerImportBodyParser(app, 'api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalFilters(new GlobalExceptionFilter())
    app.setGlobalPrefix('api')
    await app.listen(0, '127.0.0.1')
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1')
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    imports.preview.mockReset().mockResolvedValue(preview)
    imports.apply.mockReset().mockResolvedValue(preview)
    imports.exportFile.mockReset().mockResolvedValue({
      namespace: 'translation',
      language: 'de',
      tree: { a: { b: 'Text' } },
    })
    translations.createKey
      .mockReset()
      .mockResolvedValue({ id: 'k', namespace: 'translation', key: 'a' })
  })

  const post = (path: string, body: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

  const previewPath = `/api/projects/${PROJECT_ID}/translations/import/preview`
  const applyPath = `/api/projects/${PROJECT_ID}/translations/import`

  it('accepts a 150 kB body on both import paths and answers 200 with the preview', async () => {
    const body = importBody(150 * 1024)
    expect(body.length).toBeGreaterThan(150 * 1024)

    const previewResponse = await post(previewPath, body)
    expect(previewResponse.status).toBe(200)
    expect(await previewResponse.json()).toEqual(preview)

    const applyResponse = await post(applyPath, body)
    expect(applyResponse.status).toBe(200)
    expect(await applyResponse.json()).toEqual(preview)

    expect(imports.preview).toHaveBeenCalledWith(
      PROJECT_ID,
      { language: 'de' },
      JSON.parse(body).content
    )
    expect(imports.apply).toHaveBeenCalledWith(
      PROJECT_ID,
      USER_ID,
      { language: 'de' },
      JSON.parse(body).content
    )
  })

  it('also matches the import path with a trailing slash', async () => {
    const response = await post(`${previewPath}/`, importBody(150 * 1024))
    expect(response.status).toBe(200)
  })

  it('still rejects a 150 kB body on other POST routes', async () => {
    const response = await post(
      `/api/projects/${PROJECT_ID}/translation-keys`,
      JSON.stringify({ key: 'a', description: 'x'.repeat(150 * 1024) })
    )
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      statusCode: 413,
      message: 'Payload too large',
    })
    expect(translations.createKey).not.toHaveBeenCalled()
  })

  it('answers malformed JSON with 400 on any route', async () => {
    // Status only: the message comes from Nest's own SyntaxError mapping.
    for (const path of [
      `/api/projects/${PROJECT_ID}/translation-keys`,
      previewPath,
    ]) {
      const response = await post(path, '{"key":"a",')
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ statusCode: 400 })
    }
    expect(translations.createKey).not.toHaveBeenCalled()
    expect(imports.preview).not.toHaveBeenCalled()
  })

  it('keeps parsing small JSON bodies on other routes', async () => {
    const response = await post(
      `/api/projects/${PROJECT_ID}/translation-keys`,
      JSON.stringify({ key: 'a' })
    )
    expect(response.status).toBe(201)
    expect(translations.createKey).toHaveBeenCalledWith(PROJECT_ID, USER_ID, {
      key: 'a',
    })
  })

  it('answers 413 "Datei zu groß (max. 2 MB)" above the import limit', async () => {
    const response = await post(previewPath, importBody(MAX_IMPORT_BYTES + 1))
    expect(response.status).toBe(413)
    const body = await response.json()
    expect(body).toMatchObject({
      statusCode: 413,
      message: 'Datei zu groß (max. 2 MB)',
    })
    expect(imports.preview).not.toHaveBeenCalled()
  })

  it('passes content with own __proto__ and constructor keys through untouched', async () => {
    const body = `{"language":"de","content":{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"evil":"yes"}},"a":"b"}}`

    const response = await post(previewPath, body)

    expect(response.status).toBe(200)
    const content = imports.preview.mock.calls[0][2]
    expect(Object.keys(content)).toEqual(['__proto__', 'constructor', 'a'])
    expect(
      Object.getOwnPropertyDescriptor(content, '__proto__')?.value
    ).toEqual({ polluted: 'yes' })
    expect(content.constructor).toEqual({ prototype: { evil: 'yes' } })
    expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
    expect(({} as any).polluted).toBeUndefined()
    expect(({} as any).evil).toBeUndefined()
  })

  it('rejects content that is not a JSON object with 400', async () => {
    for (const content of ['[]', '"x"', '1', 'null']) {
      const response = await post(
        previewPath,
        `{"language":"de","content":${content}}`
      )
      expect(response.status).toBe(400)
    }
    const missing = await post(previewPath, JSON.stringify({ language: 'de' }))
    expect(missing.status).toBe(400)
    expect(imports.preview).not.toHaveBeenCalled()
  })

  it('validates the target fields with 400 and strips unknown ones', async () => {
    const invalid = await post(
      previewPath,
      JSON.stringify({ brandId: 'x', language: 'de', content: {} })
    )
    expect(invalid.status).toBe(400)
    const badLanguage = await post(
      previewPath,
      JSON.stringify({ language: '../de', content: {} })
    )
    expect(badLanguage.status).toBe(400)
    expect(imports.preview).not.toHaveBeenCalled()

    const extra = await post(
      previewPath,
      JSON.stringify({
        language: 'de',
        namespace: 'admin',
        foo: 'bar',
        content: { a: 'b' },
      })
    )
    expect(extra.status).toBe(200)
    expect(imports.preview).toHaveBeenCalledWith(
      PROJECT_ID,
      { language: 'de', namespace: 'admin' },
      { a: 'b' }
    )
  })

  it('serves the export as a JSON attachment', async () => {
    const response = await fetch(
      `${baseUrl}/api/projects/${PROJECT_ID}/translations/export?language=de`
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8'
    )
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="translation.de.json"'
    )
    expect(await response.json()).toEqual({ a: { b: 'Text' } })
  })

  it('rejects an invalid export query with 400', async () => {
    const response = await fetch(
      `${baseUrl}/api/projects/${PROJECT_ID}/translations/export?language=x%22y`
    )
    expect(response.status).toBe(400)
    expect(imports.exportFile).not.toHaveBeenCalled()
  })
})
