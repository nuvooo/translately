/** Lets the browser save `blob` as a file called `fileName`. */
export function saveBlobAsFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    // Revoke after the click has been handled: some browsers (Safari) abort
    // a download whose object URL is revoked synchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
