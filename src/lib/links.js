// External links (markdown bubbles, settings, anywhere a rendered <a href> appears) must open in
// the user's DEFAULT browser — never navigate the app's own webview (which would replace the whole
// UI). One delegated capture-phase click handler covers every external link in the app:
//   - electron: hand the URL to the main process → shell.openExternal (the will-navigate net in
//     electron/main.cjs is the backstop; this primary path avoids a flash of in-window navigation).
//   - web: open a new tab.
//   - android (Capacitor): do NOT preventDefault — Capacitor's WebViewClient opens off-origin
//     http(s) links in the system browser by default (the app's own origin is the only allowed
//     in-webview navigation), which is exactly the desired "default browser" behaviour.
import { sesh } from './seshClient.js'

export function installExternalLinkHandler() {
  const onClick = (e) => {
    // Let the browser's own modifier-click handling (new tab/window) win; the electron backstop
    // still externalizes those via will-navigate.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = e.target?.closest?.('a[href]')
    if (!a) return
    const href = a.getAttribute('href') || ''
    if (!/^https?:\/\//i.test(href)) return        // relative / in-app / anchor links — leave them
    if (sesh.transport === 'android') return        // Capacitor opens off-origin links externally itself
    e.preventDefault()
    if (sesh.transport === 'electron' && window.sesh?.openExternal) window.sesh.openExternal(href)
    else window.open(href, '_blank', 'noopener,noreferrer')
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
