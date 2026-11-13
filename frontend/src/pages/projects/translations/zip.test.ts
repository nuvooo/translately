import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { zipFiles } from './zip'

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

describe('zipFiles', () => {
  it('packs every file under its name with its content', async () => {
    const archive = await zipFiles([
      { name: 'translation.de.json', blob: new Blob(['{"a":"Grüße"}']) },
      { name: 'translation.en.json', blob: new Blob(['{"a":"Hello"}']) },
    ])

    expect(archive.type).toBe('application/zip')
    const files = unzipSync(await bytesOf(archive))
    expect(Object.keys(files)).toEqual([
      'translation.de.json',
      'translation.en.json',
    ])
    expect(strFromU8(files['translation.de.json'])).toBe('{"a":"Grüße"}')
    expect(strFromU8(files['translation.en.json'])).toBe('{"a":"Hello"}')
  })

  it('makes a valid empty archive without files', async () => {
    const archive = await zipFiles([])
    expect(Object.keys(unzipSync(await bytesOf(archive)))).toEqual([])
  })
})
