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
// Used by HEADLESS chats + the ticket composer, where the daemon expands @blob(hash) on send.
export async function uploadBlob(file, machine) {
  const base64 = await fileToBase64(file)
  const name = file.name || 'pasted'
  const res = await api.blobAdd(name, base64, machine)
  const info = res.blob || res
  return { token: `@blob(${info.hash})`, hash: info.hash, name, size: info.size }
}

// Upload one File then resolve its absolute on-disk PATH on the owning daemon. Used by HEADFUL
// chats (pi RPC bubbles + the claude/codex pty): the live agent is typed into directly and does
// NOT expand @blob() tokens, so we insert the literal path and the agent reads the file from it.
// Content-addressed + cross-machine-correct (the path is resolved on the thread's own machine).
// Shared with the Android gallery picker so the resolve logic isn't duplicated.
export async function uploadBlobPath(file, machine) {
  const b = await uploadBlob(file, machine)
  const r = await api.blobPath(b.hash, machine)
  return { path: r.path, hash: b.hash, name: b.name, size: b.size }
}
