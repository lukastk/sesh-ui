// Electron preload — exposes a SAFE `window.sesh` to the renderer (contextBridge), so the
// renderer never holds the bearer token or touches the socket directly. seshClient.js detects
// `window.sesh` and routes through it.
//
// `wsBase` is fetched SYNCHRONOUSLY at preload time (the main process starts its loopback WS
// bridge before this window loads), so seshClient.wsURL() can stay synchronous — the renderer
// does `new WebSocket(wsBase + path)` against main's bridge, which injects auth upstream.
const { contextBridge, ipcRenderer } = require('electron')

// main returns a STRUCTURED result ({ok,data} | {ok:false,error,status}) so a 4xx doesn't make
// Electron log the handler rejection. Unwrap it here back into resolve/throw, preserving the same
// Error shape (message + .status) the renderer already expects from the web transport.
async function unwrap(promise) {
  const r = await promise
  if (r && r.ok) return r.data
  const err = new Error(r?.error ?? 'sesh request failed')
  err.status = r?.status
  throw err
}

contextBridge.exposeInMainWorld('sesh', {
  get: (path) => unwrap(ipcRenderer.invoke('sesh:get', path)),
  post: (path, body) => unwrap(ipcRenderer.invoke('sesh:post', path, body)),
  wsBase: ipcRenderer.sendSync('sesh:ws-base'),
  getConfig: () => ipcRenderer.invoke('sesh:get-config'),
  setConfig: (cfg) => ipcRenderer.invoke('sesh:set-config', cfg),
})
