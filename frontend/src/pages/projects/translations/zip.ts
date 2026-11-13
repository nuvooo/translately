import { zipSync } from 'fflate'

function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function')
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  // Older runtimes (and jsdom) have no Blob.arrayBuffer.
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

/** Packs the files into one ZIP archive; names must be unique. */
export async function zipFiles(
  files: { name: string; blob: Blob }[]
): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) entries[file.name] = await bytesOf(file.blob)
  const zipped = zipSync(entries)
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
}
