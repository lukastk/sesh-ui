// Electron preload — exposes a SAFE `window.sesh` to the renderer (contextBridge), so the
// renderer never holds the bearer token or touches the socket directly. seshClient.js
// detects `window.sesh` and routes through it. [Phase 0/2 — flesh out main.cjs.]
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sesh', {
  get: (path) => ipcRenderer.invoke('sesh:get', path),
  post: (path, body) => ipcRenderer.invoke('sesh:post', path, body),
  // For WS the main process returns an already-authenticated URL (e.g. a localhost relay it
  // owns, or the daemon TCP URL with the token applied out-of-band). Decide in Phase 0.
  wsURL: (path) => ipcRenderer.invoke('sesh:wsURL', path),
})
