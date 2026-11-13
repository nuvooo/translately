import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { AiTranslationController } from './ai-translation.controller'
import { AiTranslationService } from './ai-translation.service'
import { ApplyDto } from './dto/apply.dto'
import { PreviewMissingDto } from './dto/preview-missing.dto'
import { SuggestDto } from './dto/suggest.dto'

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const BRAND_ID = 'eeeeeeeeeeeeeeeeeeeeeeee'
const KEY_ID = '111111111111111111111111'
const req = { user: { userId: USER_ID } }

function setup(opts: { enabled?: boolean; role?: 'MEMBER' | 'VIEWER' } = {}) {
  const role = opts.role ?? 'MEMBER'
  const access = {
    assertProjectAccess: jest
      .fn()
      .mockImplementation(
        async (_user: string, _project: string, min: string) => {
          if (role === 'VIEWER' && min !== 'VIEWER') {
            throw new ForbiddenException('Insufficient permissions')
          }
          return {}
        }
      ),
    assertBrandInProject: jest.fn().mockResolvedValue({ id: BRAND_ID }),
  }
  const translator = {
    isEnabled: jest.fn().mockReturnValue(opts.enabled ?? true),
    translate: jest.fn(),
  }
  // A real service on a database that must not be touched without a key.
  const prisma: any = new Proxy(
    {},
    {
      get() {
        throw new Error('database must not be used')
      },
    }
  )
  const service = new AiTranslationService(
    prisma,
    translator as any,
    { recordChange: jest.fn() } as any,
    { create: jest.fn() } as any
  )
  const spies = {
    suggest: jest.spyOn(service, 'suggest'),
    previewMissing: jest.spyOn(service, 'previewMissing'),
    apply: jest.spyOn(service, 'apply'),
  }
  const controller = new AiTranslationController(
    service,
    translator as any,
    access as any
  )
  return { controller, access, translator, spies }
}

const suggestBody = (extra: Record<string, unknown> = {}) =>
  plainToInstance(SuggestDto, {
    sourceLanguage: 'de',
    targetLanguage: 'en',
    keyIds: [KEY_ID],
    ...extra,
  })

describe('AiTranslationController', () => {
  describe('GET ai-translation/status', () => {
    it('reports disabled without a key', () => {
      const { controller } = setup({ enabled: false })
      expect(controller.status()).toEqual({ enabled: false })
    })

    it('reports enabled with a key', () => {
      const { controller } = setup({ enabled: true })
      expect(controller.status()).toEqual({ enabled: true })
    })
  })

  describe('POST suggest', () => {
    it('requires MEMBER and checks the brand', async () => {
      const { controller, access, spies } = setup()
      spies.suggest.mockResolvedValue({ suggestions: [], skipped: [] })
      const dto = suggestBody({ brandId: BRAND_ID })

      await controller.suggest(PROJECT_ID, dto, req)

      expect(access.assertProjectAccess).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        'MEMBER'
      )
      expect(access.assertBrandInProject).toHaveBeenCalledWith(
        BRAND_ID,
        PROJECT_ID
      )
      expect(spies.suggest).toHaveBeenCalledWith(PROJECT_ID, dto)
    })

    it('rejects a VIEWER with 403', async () => {
      const { controller, spies } = setup({ role: 'VIEWER' })
      await expect(
        controller.suggest(PROJECT_ID, suggestBody(), req)
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(spies.suggest).not.toHaveBeenCalled()
    })

    it('rejects a brand of another project with 404', async () => {
      const { controller, access, spies } = setup()
      access.assertBrandInProject.mockRejectedValue(
        new NotFoundException('Brand not found')
      )
      await expect(
        controller.suggest(PROJECT_ID, suggestBody({ brandId: BRAND_ID }), req)
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(spies.suggest).not.toHaveBeenCalled()
    })

    it('answers 503 ai_translation_disabled without a key', async () => {
      const { controller } = setup({ enabled: false })
      const error: any = await controller
        .suggest(PROJECT_ID, suggestBody(), req)
        .catch((e) => e)
      expect(error.getStatus()).toBe(503)
      expect(error.getResponse()).toMatchObject({
        code: 'ai_translation_disabled',
      })
    })
  })

  describe('POST preview-missing', () => {
    it('rejects a VIEWER with 403', async () => {
      const { controller, spies } = setup({ role: 'VIEWER' })
      const dto = plainToInstance(PreviewMissingDto, {
        sourceLanguage: 'de',
        targetLanguages: ['en'],
      })
      await expect(
        controller.previewMissing(PROJECT_ID, dto, req)
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(spies.previewMissing).not.toHaveBeenCalled()
    })

    it('requires MEMBER and delegates', async () => {
      const { controller, access, spies } = setup()
      spies.previewMissing.mockResolvedValue({ languages: [] })
      const dto = plainToInstance(PreviewMissingDto, {
        sourceLanguage: 'de',
        targetLanguages: ['en'],
      })
      await controller.previewMissing(PROJECT_ID, dto, req)
      expect(access.assertProjectAccess).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        'MEMBER'
      )
      expect(spies.previewMissing).toHaveBeenCalledWith(PROJECT_ID, dto)
    })
  })

  describe('POST apply', () => {
    const body = (extra: Record<string, unknown> = {}) =>
      plainToInstance(ApplyDto, {
        targetLanguage: 'en',
        values: [{ keyId: KEY_ID, value: 'One' }],
        ...extra,
      })

    it('rejects a VIEWER with 403', async () => {
      const { controller, spies } = setup({ role: 'VIEWER' })
      await expect(
        controller.apply(PROJECT_ID, body(), req)
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(spies.apply).not.toHaveBeenCalled()
    })

    it('requires MEMBER, checks the brand and works without a key', async () => {
      const { controller, access, spies } = setup({ enabled: false })
      spies.apply.mockResolvedValue({ written: 1, skippedExisting: 0 })
      const dto = body({ brandId: BRAND_ID })
      const result = await controller.apply(PROJECT_ID, dto, req)
      expect(access.assertBrandInProject).toHaveBeenCalledWith(
        BRAND_ID,
        PROJECT_ID
      )
      expect(spies.apply).toHaveBeenCalledWith(PROJECT_ID, USER_ID, dto)
      expect(result).toEqual({ written: 1, skippedExisting: 0 })
    })
  })

  describe('DTO validation', () => {
    it('accepts 50 key ids and rejects 51', async () => {
      const ids = (n: number) =>
        Array.from({ length: n }, (_, i) => i.toString(16).padStart(24, '0'))
      expect(await validate(suggestBody({ keyIds: ids(50) }))).toHaveLength(0)
      expect(await validate(suggestBody({ keyIds: ids(51) }))).not.toHaveLength(
        0
      )
    })

    it('rejects empty key ids and malformed languages', async () => {
      expect(await validate(suggestBody({ keyIds: [] }))).not.toHaveLength(0)
      expect(
        await validate(suggestBody({ targetLanguage: 'x y' }))
      ).not.toHaveLength(0)
    })

    it('limits preview targets (1..3) and limit (1..50)', async () => {
      const make = (extra: Record<string, unknown>) =>
        plainToInstance(PreviewMissingDto, {
          sourceLanguage: 'de',
          targetLanguages: ['en'],
          ...extra,
        })
      const langs = (n: number) =>
        Array.from({ length: n }, (_, i) => `a${String.fromCharCode(97 + i)}`)
      expect(await validate(make({}))).toHaveLength(0)
      expect(
        await validate(make({ targetLanguages: langs(3), limit: 50 }))
      ).toHaveLength(0)
      expect(
        await validate(make({ targetLanguages: langs(4) }))
      ).not.toHaveLength(0)
      expect(await validate(make({ targetLanguages: [] }))).not.toHaveLength(0)
      expect(await validate(make({ limit: 51 }))).not.toHaveLength(0)
      expect(await validate(make({ limit: 0 }))).not.toHaveLength(0)
    })

    it('limits apply values (1..200) and rejects empty or oversize values', async () => {
      const values = (n: number) =>
        Array.from({ length: n }, () => ({ keyId: KEY_ID, value: 'x' }))
      const make = (v: unknown) =>
        plainToInstance(ApplyDto, { targetLanguage: 'en', values: v })
      expect(await validate(make(values(200)))).toHaveLength(0)
      expect(await validate(make(values(201)))).not.toHaveLength(0)
      expect(await validate(make([]))).not.toHaveLength(0)
      expect(
        await validate(make([{ keyId: KEY_ID, value: '' }]))
      ).not.toHaveLength(0)
      expect(
        await validate(make([{ keyId: KEY_ID, value: 'x'.repeat(10_001) }]))
      ).not.toHaveLength(0)
    })
  })
})
