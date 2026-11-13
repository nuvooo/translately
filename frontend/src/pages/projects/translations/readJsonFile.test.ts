import { describe, expect, it, vi } from 'vitest'
import { MAX_IMPORT_BYTES, readJsonFile } from './readJsonFile'

const jsonFile = (text: string, name = 'de.json') =>
  new File([text], name, { type: 'application/json' })

describe('readJsonFile', () => {
  it('3 MB → too_large, ohne die Datei zu lesen', async () => {
    const file = new File([new Uint8Array(3 * 1024 * 1024)], 'big.json')
    const text = vi.spyOn(file, 'text')
    expect(await readJsonFile(file)).toEqual({ ok: false, error: 'too_large' })
    expect(text).not.toHaveBeenCalled()
  })

  it('genau an der Grenze wird gelesen', async () => {
    const body = `{"a":"${'x'.repeat(MAX_IMPORT_BYTES - 8)}"}`
    const file = jsonFile(body)
    expect(file.size).toBe(MAX_IMPORT_BYTES)
    const result = await readJsonFile(file)
    expect(result.ok).toBe(true)
  })

  it('"[1]" → not_object', async () => {
    expect(await readJsonFile(jsonFile('[1]'))).toEqual({
      ok: false,
      error: 'not_object',
    })
  })

  it('null, Zahl und String → not_object', async () => {
    for (const text of ['null', '42', '"text"', 'true']) {
      expect(await readJsonFile(jsonFile(text))).toEqual({
        ok: false,
        error: 'not_object',
      })
    }
  })

  it('"{" → not_json', async () => {
    expect(await readJsonFile(jsonFile('{'))).toEqual({
      ok: false,
      error: 'not_json',
    })
  })

  it('leere Datei → not_json', async () => {
    expect(await readJsonFile(jsonFile(''))).toEqual({
      ok: false,
      error: 'not_json',
    })
  })

  it('gültig → ok mit dem Inhalt, verschachtelt wie in der Datei', async () => {
    expect(
      await readJsonFile(jsonFile('{"checkout":{"title":"Kasse"},"a.b":"c"}'))
    ).toEqual({
      ok: true,
      content: { checkout: { title: 'Kasse' }, 'a.b': 'c' },
    })
  })

  it('leeres Objekt ist ok', async () => {
    expect(await readJsonFile(jsonFile('{}'))).toEqual({
      ok: true,
      content: {},
    })
  })

  it('entfernt ein führendes UTF-8-BOM', async () => {
    expect(await readJsonFile(jsonFile('﻿{"a":"b"}'))).toEqual({
      ok: true,
      content: { a: 'b' },
    })
  })

  it('reicht Keys wie __proto__ unverändert als eigene Eigenschaft weiter', async () => {
    const result = await readJsonFile(jsonFile('{"__proto__":{"x":"y"}}'))
    if (!result.ok) throw new Error('expected ok')
    expect(Object.keys(result.content)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(result.content)).toBe(Object.prototype)
  })
})
