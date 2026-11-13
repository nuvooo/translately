import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveBlobAsFile } from './saveBlob'

describe('saveBlobAsFile', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('downloads the blob under the file name and revokes the object URL', () => {
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    let clicked: HTMLAnchorElement | undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked = this
    })
    const blob = new Blob(['{}'])
    vi.useFakeTimers()

    saveBlobAsFile(blob, 'translation.de.json')

    expect(create).toHaveBeenCalledWith(blob)
    expect(clicked).toBeDefined()
    expect(clicked?.download).toBe('translation.de.json')
    expect(clicked?.href).toBe('blob:x')
    expect(document.querySelector('a[download]')).toBeNull()
    // Revoked only after the click has been handled: some browsers (Safari)
    // abort a download whose URL is revoked synchronously.
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })
})
