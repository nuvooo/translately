import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateKeyDto } from './dto/create-key.dto'
import {
  ExportQueryDto,
  ImportContentPipe,
  ImportTargetDto,
} from './dto/import.dto'
import { LinkDto } from './dto/link.dto'
import { NamespaceDto } from './dto/namespace.dto'
import { SetLanguagesDto } from './dto/set-languages.dto'
import { SetValueDto } from './dto/set-value.dto'
import { TableQueryDto } from './dto/table-query.dto'
import { UpdateKeyDto } from './dto/update-key.dto'
import { MAX_VALUE_LENGTH } from './limits'
import { TranslationsController } from './translations.controller'

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const PROJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const BRAND_ID = 'eeeeeeeeeeeeeeeeeeeeeeee'
const KEY_ID = '111111111111111111111111'

const req = { user: { userId: USER_ID } }
const keyResult = { id: KEY_ID, namespace: 'translation', key: 'a' }
const preview = {
  added: ['a'],
  changed: [],
  unchanged: [],
  newKeys: ['a'],
  skipped: [],
}

function setup() {
  const access = {
    assertProjectAccess: jest.fn().mockResolvedValue({}),
    assertTranslationKeyAccess: jest
      .fn()
      .mockResolvedValue({ key: { id: KEY_ID, projectId: PROJECT_ID } }),
    assertBrandInProject: jest.fn().mockResolvedValue({ id: BRAND_ID }),
    assertBrandAccess: jest.fn().mockResolvedValue({}),
  }
  const service = {
    getTable: jest.fn().mockResolvedValue({ rows: [] }),
    createKey: jest.fn().mockResolvedValue(keyResult),
    updateKey: jest.fn().mockResolvedValue(keyResult),
    deleteKey: jest.fn().mockResolvedValue(undefined),
    setKeyLocked: jest.fn().mockResolvedValue({ ...keyResult, locked: true }),
    setValue: jest.fn().mockResolvedValue({ value: 'x', inherited: false }),
  }
  const links = {
    unlink: jest.fn().mockResolvedValue({ value: 'Hallo', inherited: false }),
    link: jest.fn().mockResolvedValue({ value: 'Hallo', inherited: true }),
  }
  const settings = {
    setProjectLanguages: jest
      .fn()
      .mockResolvedValue({ languages: ['de'], removedValues: 3 }),
    setBrandLanguages: jest
      .fn()
      .mockResolvedValue({ languages: ['fr'], removedValues: 0 }),
    addNamespace: jest.fn().mockResolvedValue({ namespaces: ['translation'] }),
    removeNamespace: jest
      .fn()
      .mockResolvedValue({ namespaces: ['translation'], removedKeys: 2 }),
  }
  const imports = {
    preview: jest.fn().mockResolvedValue(preview),
    apply: jest.fn().mockResolvedValue(preview),
    exportFile: jest.fn().mockResolvedValue({
      namespace: 'admin',
      language: 'pt-BR',
      tree: { a: { b: 'x' } },
    }),
  }
  const controller = new TranslationsController(
    service as any,
    access as any,
    settings as any,
    imports as any,
    links as any
  )
  return { controller, access, service, settings, imports, links }
}

describe('TranslationsController', () => {
  describe('GET projects/:projectId/translations', () => {
    it('requires VIEWER and passes the query on', async () => {
      const { controller, access, service } = setup()
      const query = {}

      const result = await controller.getTable(PROJECT_ID, query, req)

      expect(access.assertProjectAccess).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        'VIEWER'
      )
      expect(access.assertBrandInProject).not.toHaveBeenCalled()
      expect(service.getTable).toHaveBeenCalledWith(PROJECT_ID, query)
      expect(result).toEqual({ rows: [] })
    })
  })

  describe('POST projects/:projectId/translations/import/preview', () => {
    it('requires MEMBER, checks the brand and returns the preview', async () => {
      const { controller, access, imports } = setup()
      const dto = { language: 'de', brandId: BRAND_ID }
      const content = { a: 'x' }

      const result = await controller.previewImport(
        PROJECT_ID,
        dto,
        content,
        req
      )

      expect(access.assertProjectAccess).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        'MEMBER'
      )
      expect(access.assertBrandInProject).toHaveBeenCalledWith(
        BRAND_ID,
        PROJECT_ID
      )
      expect(imports.preview).toHaveBeenCalledWith(PROJECT_ID, dto, content)
      expect(imports.apply).not.toHaveBeenCalled()
      expect(result).toBe(preview)
    })
  })

  describe('POST projects/:projectId/translations/import', () => {
    it('requires MEMBER and returns the applied preview', async () => {
      const { controller, access, imports } = setup()
      const dto = { language: 'de' }
      const content = { a: 'x' }

      const result = await controller.applyImport(PROJECT_ID, dto, content, req)

      expect(access.assertProjectAccess).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        'MEMBER'
      )
      expect(access.assertBrandInProject).not.toHaveBeenCalled()
      expect(imports.apply).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID,
        dto,
        content
      )
      expect(result).toBe(preview)
    })

    it('stops when the brand belongs to another project', async () => {
      const { controller, access, imports } = setup()
      access.assertBrandInProject.mockRejectedValue(new NotFoundException())
      await expect(
        controller.applyImport(
          PROJECT_ID,
          { language: 'de', brandId: BRAND_ID },
          { a: 'x' },
          req
        )
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(imports.apply).not.toHaveBeenCalled()
    })
  })

  describe('GET projects/:projectId/translations/export', () => {
    it('requires VIEWER and sends the tree as a JSON attachment', async () => {
      const { controller, access, imports } = setup()
      const query = {
        language: 'pt-BR',
        namespace: 'admin',
        brandId: BRAND_ID,
      }
      const res = { setHeader: jest.fn() }

      const result = await controller.exportFile(PROJECT_ID, query, req, res)

      expect(access.assertProjectAccess).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        'VIEWER'
      )
      expect(access.assertBrandInProject).toHaveBeenCalledWith(
        BRAND_ID,
        PROJECT_ID
      )
      expect(imports.exportFile).toHaveBeenCalledWith(PROJECT_ID, query)
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/json; charset=utf-8'
      )
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="admin.pt-BR.json"'
      )
      expect(result).toEqual({ a: { b: 'x' } })
    })

    it('sets no header when the service rejects the view', async () => {
      const { controller, imports } = setup()
      imports.exportFile.mockRejectedValue(new BadRequestException())
      const res = { setHeader: jest.fn() }
      await expect(
        controller.exportFile(PROJECT_ID, { language: 'fr' }, req, res)
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(res.setHeader).not.toHaveBeenCalled()
    })
  })

  describe('POST projects/:projectId/translation-keys', () => {
    it('requires MEMBER and returns { key }', async () => {
      const { controller, access, service } = setup()
      const dto = { key: 'a' }

      const result = await controller.createKey(PROJECT_ID, dto, req)

      expect(access.assertProjectAccess).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        'MEMBER'
      )
      expect(service.createKey).toHaveBeenCalledWith(PROJECT_ID, USER_ID, dto)
      expect(result).toEqual({ key: keyResult })
    })
  })

  describe('PATCH translation-keys/:keyId', () => {
    it('requires MEMBER and returns { key }', async () => {
      const { controller, access, service } = setup()
      const dto = { key: 'b' }

      const result = await controller.updateKey(KEY_ID, dto, req)

      expect(access.assertTranslationKeyAccess).toHaveBeenCalledWith(
        USER_ID,
        KEY_ID,
        'MEMBER'
      )
      expect(service.updateKey).toHaveBeenCalledWith(KEY_ID, USER_ID, dto)
      expect(result).toEqual({ key: keyResult })
    })
  })

  describe('PUT translation-keys/:keyId/lock', () => {
    it('requires ADMIN and returns { key }', async () => {
      const { controller, access, service } = setup()

      const result = await controller.setKeyLocked(
        KEY_ID,
        { locked: true },
        req
      )

      expect(access.assertTranslationKeyAccess).toHaveBeenCalledWith(
        USER_ID,
        KEY_ID,
        'ADMIN'
      )
      expect(service.setKeyLocked).toHaveBeenCalledWith(KEY_ID, USER_ID, true)
      expect(result).toEqual({ key: { ...keyResult, locked: true } })
    })
  })

  describe('DELETE translation-keys/:keyId', () => {
    it('requires ADMIN and returns { success: true }', async () => {
      const { controller, access, service } = setup()

      const result = await controller.deleteKey(KEY_ID, req)

      expect(access.assertTranslationKeyAccess).toHaveBeenCalledWith(
        USER_ID,
        KEY_ID,
        'ADMIN'
      )
      expect(service.deleteKey).toHaveBeenCalledWith(KEY_ID, USER_ID)
      expect(result).toEqual({ success: true })
    })
  })

  describe('PUT translation-keys/:keyId/value', () => {
    it('requires MEMBER and returns { cell }', async () => {
      const { controller, access, service } = setup()
      const dto = { language: 'de', value: 'x' }

      const result = await controller.setValue(KEY_ID, dto, req)

      expect(access.assertTranslationKeyAccess).toHaveBeenCalledWith(
        USER_ID,
        KEY_ID,
        'MEMBER'
      )
      expect(access.assertBrandInProject).not.toHaveBeenCalled()
      expect(service.setValue).toHaveBeenCalledWith(KEY_ID, USER_ID, dto)
      expect(result).toEqual({ cell: { value: 'x', inherited: false } })
    })

    it('checks brand ownership when brandId is given', async () => {
      const { controller, access } = setup()
      await controller.setValue(
        KEY_ID,
        {
          language: 'de',
          brandId: BRAND_ID,
          value: 'x',
        },
        req
      )
      expect(access.assertBrandInProject).toHaveBeenCalledWith(
        BRAND_ID,
        PROJECT_ID
      )
    })

    it('stops when the brand belongs to another project', async () => {
      const { controller, access, service } = setup()
      access.assertBrandInProject.mockRejectedValue(new NotFoundException())
      await expect(
        controller.setValue(
          KEY_ID,
          {
            language: 'de',
            brandId: BRAND_ID,
            value: 'x',
          },
          req
        )
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(service.setValue).not.toHaveBeenCalled()
    })
  })
})

describe('TranslationsController link routes', () => {
  const dto = { language: 'de' }

  it.each([
    ['unlinkValue', 'unlink', { value: 'Hallo', inherited: false }],
    ['linkValue', 'link', { value: 'Hallo', inherited: true }],
  ] as const)(
    '%s requires MEMBER and returns { cell }',
    async (route, method, cell) => {
      const { controller, access, links } = setup()

      const result = await controller[route](KEY_ID, BRAND_ID, dto, req)

      expect(access.assertTranslationKeyAccess).toHaveBeenCalledWith(
        USER_ID,
        KEY_ID,
        'MEMBER'
      )
      expect(access.assertBrandInProject).toHaveBeenCalledWith(
        BRAND_ID,
        PROJECT_ID
      )
      expect(links[method]).toHaveBeenCalledWith(KEY_ID, USER_ID, {
        brandId: BRAND_ID,
        language: 'de',
      })
      expect(result).toEqual({ cell })
    }
  )

  it.each(['unlinkValue', 'linkValue'] as const)(
    '%s rejects a VIEWER with 403',
    async (route) => {
      const { controller, access, links } = setup()
      access.assertTranslationKeyAccess.mockRejectedValue(
        new ForbiddenException()
      )
      await expect(
        controller[route](KEY_ID, BRAND_ID, dto, req)
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(links.unlink).not.toHaveBeenCalled()
      expect(links.link).not.toHaveBeenCalled()
    }
  )

  it.each(['unlinkValue', 'linkValue'] as const)(
    '%s 404s for a brand of another project',
    async (route) => {
      const { controller, access, links } = setup()
      access.assertBrandInProject.mockRejectedValue(new NotFoundException())
      await expect(
        controller[route](KEY_ID, BRAND_ID, dto, req)
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(links.unlink).not.toHaveBeenCalled()
      expect(links.link).not.toHaveBeenCalled()
    }
  )

  it('LinkDto validates the language like SetValueDto', async () => {
    const ok = await validate(plainToInstance(LinkDto, { language: 'pt-BR' }))
    const bad = await validate(plainToInstance(LinkDto, { language: 'x y' }))
    expect(ok).toHaveLength(0)
    expect(bad.length).toBeGreaterThan(0)
  })
})

describe('TranslationsController settings routes', () => {
  it('PUT projects/:projectId/languages requires ADMIN and returns the service result', async () => {
    const { controller, access, settings } = setup()

    const result = await controller.setProjectLanguages(
      PROJECT_ID,
      { languages: ['de'] },
      req
    )

    expect(access.assertProjectAccess).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      'ADMIN'
    )
    expect(settings.setProjectLanguages).toHaveBeenCalledWith(
      PROJECT_ID,
      USER_ID,
      ['de'],
      undefined
    )
    expect(result).toEqual({ languages: ['de'], removedValues: 3 })
  })

  it('passes the expected list of both language routes to the service', async () => {
    const { controller, settings } = setup()

    await controller.setProjectLanguages(
      PROJECT_ID,
      { languages: ['de'], expected: ['de', 'en'] },
      req
    )
    await controller.setBrandLanguages(
      BRAND_ID,
      { languages: ['fr'], expected: [] },
      req
    )

    expect(settings.setProjectLanguages).toHaveBeenCalledWith(
      PROJECT_ID,
      USER_ID,
      ['de'],
      ['de', 'en']
    )
    expect(settings.setBrandLanguages).toHaveBeenCalledWith(
      BRAND_ID,
      USER_ID,
      ['fr'],
      []
    )
  })

  it('PUT brands/:brandId/languages requires ADMIN on the brand', async () => {
    const { controller, access, settings } = setup()

    const result = await controller.setBrandLanguages(
      BRAND_ID,
      { languages: ['fr'] },
      req
    )

    expect(access.assertBrandAccess).toHaveBeenCalledWith(
      USER_ID,
      BRAND_ID,
      'ADMIN'
    )
    expect(settings.setBrandLanguages).toHaveBeenCalledWith(
      BRAND_ID,
      USER_ID,
      ['fr'],
      undefined
    )
    expect(result).toEqual({ languages: ['fr'], removedValues: 0 })
  })

  it('POST projects/:projectId/namespaces requires ADMIN', async () => {
    const { controller, access, settings } = setup()

    const result = await controller.addNamespace(
      PROJECT_ID,
      { namespace: 'shop' },
      req
    )

    expect(access.assertProjectAccess).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      'ADMIN'
    )
    expect(settings.addNamespace).toHaveBeenCalledWith(
      PROJECT_ID,
      USER_ID,
      'shop'
    )
    expect(result).toEqual({ namespaces: ['translation'] })
  })

  it('DELETE projects/:projectId/namespaces/:namespace requires ADMIN', async () => {
    const { controller, access, settings } = setup()

    const result = await controller.removeNamespace(PROJECT_ID, 'shop', req)

    expect(access.assertProjectAccess).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      'ADMIN'
    )
    expect(settings.removeNamespace).toHaveBeenCalledWith(
      PROJECT_ID,
      USER_ID,
      'shop'
    )
    expect(result).toEqual({ namespaces: ['translation'], removedKeys: 2 })
  })

  it('does not call the service when access is denied', async () => {
    const { controller, access, settings } = setup()
    access.assertProjectAccess.mockRejectedValue(new NotFoundException())
    access.assertBrandAccess.mockRejectedValue(new NotFoundException())

    await expect(
      controller.setProjectLanguages(PROJECT_ID, { languages: [] }, req)
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      controller.setBrandLanguages(BRAND_ID, { languages: [] }, req)
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      controller.addNamespace(PROJECT_ID, { namespace: 'x' }, req)
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      controller.removeNamespace(PROJECT_ID, 'x', req)
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(settings.setProjectLanguages).not.toHaveBeenCalled()
    expect(settings.setBrandLanguages).not.toHaveBeenCalled()
    expect(settings.addNamespace).not.toHaveBeenCalled()
    expect(settings.removeNamespace).not.toHaveBeenCalled()
  })
})

async function errorsOf(cls: any, plain: object) {
  const errors = await validate(plainToInstance(cls, plain) as object, {
    whitelist: true,
  })
  return errors.map((e) => e.property)
}

describe('translation DTOs', () => {
  it('SetLanguagesDto requires an array of valid language codes', async () => {
    expect(await errorsOf(SetLanguagesDto, { languages: [] })).toEqual([])
    expect(
      await errorsOf(SetLanguagesDto, { languages: ['de', 'de-DE', 'DE'] })
    ).toEqual([])
    expect(await errorsOf(SetLanguagesDto, { languages: ['d'] })).toEqual([
      'languages',
    ])
    expect(await errorsOf(SetLanguagesDto, { languages: [1] })).toEqual([
      'languages',
    ])
    expect(await errorsOf(SetLanguagesDto, { languages: 'de' })).toEqual([
      'languages',
    ])
    expect(await errorsOf(SetLanguagesDto, {})).toEqual(['languages'])
  })

  it('SetLanguagesDto accepts an optional expected list of valid codes', async () => {
    expect(
      await errorsOf(SetLanguagesDto, { languages: ['de'], expected: [] })
    ).toEqual([])
    expect(
      await errorsOf(SetLanguagesDto, {
        languages: ['de'],
        expected: ['de', 'en-US'],
      })
    ).toEqual([])
    expect(
      await errorsOf(SetLanguagesDto, { languages: ['de'], expected: 'de' })
    ).toEqual(['expected'])
    expect(
      await errorsOf(SetLanguagesDto, {
        languages: ['de'],
        expected: ['de_DE'],
      })
    ).toEqual(['expected'])
    expect(
      await errorsOf(SetLanguagesDto, { languages: ['de'], expected: [1] })
    ).toEqual(['expected'])
  })

  it('SetLanguagesDto rejects expected: null (send an array or omit it)', async () => {
    expect(
      await errorsOf(SetLanguagesDto, { languages: ['de'], expected: null })
    ).toEqual(['expected'])
    expect(await errorsOf(SetLanguagesDto, { languages: ['de'] })).toEqual([])
  })

  it('SetLanguagesDto rejects oversized arrays early', async () => {
    const huge = Array.from({ length: 1001 }, () => 'de')
    expect(await errorsOf(SetLanguagesDto, { languages: huge })).toEqual([
      'languages',
    ])
    expect(
      await errorsOf(SetLanguagesDto, { languages: ['de'], expected: huge })
    ).toEqual(['expected'])
    // Duplicates below the ceiling still pass; the service de-duplicates.
    const many = Array.from({ length: 1000 }, () => 'de')
    expect(await errorsOf(SetLanguagesDto, { languages: many })).toEqual([])
  })

  it('NamespaceDto validates the namespace pattern', async () => {
    expect(await errorsOf(NamespaceDto, { namespace: 'shop_1' })).toEqual([])
    expect(await errorsOf(NamespaceDto, { namespace: 'a b' })).toEqual([
      'namespace',
    ])
    expect(await errorsOf(NamespaceDto, {})).toEqual(['namespace'])
  })

  it('CreateKeyDto validates key, namespace and description', async () => {
    expect(await errorsOf(CreateKeyDto, { key: 'home.title' })).toEqual([])
    expect(await errorsOf(CreateKeyDto, { key: 'a..b' })).toEqual(['key'])
    expect(
      await errorsOf(CreateKeyDto, { key: 'a', namespace: 'a b' })
    ).toEqual(['namespace'])
    expect(
      await errorsOf(CreateKeyDto, { key: 'a', description: 'x'.repeat(501) })
    ).toEqual(['description'])
  })

  it('UpdateKeyDto accepts description null', async () => {
    expect(await errorsOf(UpdateKeyDto, { description: null })).toEqual([])
    expect(await errorsOf(UpdateKeyDto, { key: '.a' })).toEqual(['key'])
  })

  it('SetValueDto validates ids, language and value length', async () => {
    const ok = { language: 'de-DE', value: '' }
    expect(await errorsOf(SetValueDto, ok)).toEqual([])
    expect(
      await errorsOf(SetValueDto, {
        ...ok,
        value: 'x'.repeat(MAX_VALUE_LENGTH + 1),
      })
    ).toEqual(['value'])
    expect(await errorsOf(SetValueDto, { ...ok, language: 'd' })).toEqual([
      'language',
    ])
    expect(await errorsOf(SetValueDto, { ...ok, brandId: 'x' })).toEqual([
      'brandId',
    ])
    expect(await errorsOf(SetValueDto, { language: 'de' })).toEqual(['value'])
  })

  it('TableQueryDto converts query strings and clamps pageSize', async () => {
    const dto = plainToInstance(TableQueryDto, {
      missingOnly: 'true',
      page: '2',
      pageSize: '1000',
      search: '  hello  ',
    })
    expect(await validate(dto)).toEqual([])
    expect(dto.missingOnly).toBe(true)
    expect(dto.page).toBe(2)
    expect(dto.pageSize).toBe(200)
    expect(dto.search).toBe('hello')
    expect(
      plainToInstance(TableQueryDto, {
        missingOnly: 'false',
      }).missingOnly
    ).toBe(false)
  })

  it('TableQueryDto rejects invalid values', async () => {
    expect(await errorsOf(TableQueryDto, { page: '0' })).toEqual(['page'])
    expect(await errorsOf(TableQueryDto, { pageSize: 'x' })).toEqual([
      'pageSize',
    ])
    expect(
      await errorsOf(TableQueryDto, {
        missingOnly: 'yes',
      })
    ).toEqual(['missingOnly'])
    expect(
      await errorsOf(TableQueryDto, {
        search: 'x'.repeat(201),
      })
    ).toEqual(['search'])
    expect(await errorsOf(TableQueryDto, {})).toEqual([])
  })
})

describe('import DTOs', () => {
  async function propertiesWithErrors(cls: any, input: object) {
    const errors = await validate(plainToInstance(cls, input))
    return errors.map((e) => e.property).sort()
  }

  it('ImportTargetDto accepts a valid target and rejects invalid fields', async () => {
    expect(
      await propertiesWithErrors(ImportTargetDto, {
        language: 'pt-BR',
        namespace: 'admin',
        brandId: BRAND_ID,
      })
    ).toEqual([])
    expect(
      await propertiesWithErrors(ImportTargetDto, {
        language: 'not a language',
        namespace: 'a/b',
        brandId: 'y',
      })
    ).toEqual(['brandId', 'language', 'namespace'])
    expect(await propertiesWithErrors(ImportTargetDto, {})).toEqual([
      'language',
    ])
  })

  it('ExportQueryDto validates like the import target', async () => {
    expect(
      await propertiesWithErrors(ExportQueryDto, {
        language: 'de',
      })
    ).toEqual([])
    expect(await propertiesWithErrors(ExportQueryDto, {})).toEqual(['language'])
  })

  it('ImportContentPipe passes JSON objects through untouched and rejects the rest', () => {
    const pipe = new ImportContentPipe()
    const content = JSON.parse('{"__proto__":{"x":"1"},"constructor":"c"}')
    expect(pipe.transform(content)).toBe(content)
    for (const value of [undefined, null, [], 'x', 1, true]) {
      expect(() => pipe.transform(value)).toThrow(BadRequestException)
    }
  })
})
