// Blob attachments: upload a file/image to a daemon's blob store and reference it from a prompt by
// an `@blob(<hash>)` token (the daemon expands it to a path on send / send-headless / ticket
// send-prompt). Files must target the THREAD'S OWNING machine, so callers pass that machine through.
import { api } from './seshClient.js'

// Read a File/Blob as base64 (without the `data:<mime>;base64,` prefix the daemon doesn't want).
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(r.error || new Error('read failed'))
    r.readAsDataURL(file)
  })
}

// Upload one File to the (owning machine's) blob store. Returns { token, hash, name, size }.
export async function uploadBlob(file, machine) {
  const base64 = await fileToBase64(file)
  const name = file.name || 'pasted'
  const res = await api.blobAdd(name, base64, machine)
  const info = res.blob || res
  return { token: `@blob(${info.hash})`, hash: info.hash, name, size: info.size }
}
