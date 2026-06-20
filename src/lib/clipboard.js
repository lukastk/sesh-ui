// Copy text to the clipboard, robust across environments. The async Clipboard API
// (navigator.clipboard.writeText) can be permission-blocked or even HANG in restricted contexts
// (some webviews / headless), so try a synchronous hidden-textarea + execCommand('copy') first —
// that works there — and fall back to the async API. Returns true if a copy was performed.
export function copyText(text) {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (ok) return true
  } catch {}
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).catch(() => {}); return true }
  return false
}
