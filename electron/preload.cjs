// Electron preload — exposes a SAFE `window.sesh` to the renderer (contextBridge), so the
// renderer never holds the bearer token or touches the socket directly. seshClient.js detects
// `window.sesh` and routes through it.
//
// `wsBase` is fetched SYNCHRONOUSLY at preload time (the main process starts its loopback WS
// bridge before this window loads), so seshClient.wsURL() can stay synchronous — the renderer
// does `new WebSocket(wsBase + path)` against main's bridge, which injects auth upstream.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sesh', {
  get: (path) => ipcRenderer.invoke('sesh:get', path),
  post: (path, body) => ipcRenderer.invoke('sesh:post', path, body),
  wsBase: ipcRenderer.sendSync('sesh:ws-base'),
  getConfig: () => ipcRenderer.invoke('sesh:get-config'),
  setConfig: (cfg) => ipcRenderer.invoke('sesh:set-config', cfg),
})
