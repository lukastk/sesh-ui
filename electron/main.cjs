// Electron main process — the trusted transport layer for the renderer.
//
// The renderer reaches the daemon ONLY through here: ipcRenderer.invoke('sesh:get'|'sesh:post')
// for HTTP, and a loopback WS bridge (its base handed to the renderer synchronously) for the
// rpc/terminal WebSockets. The bearer token lives ONLY in main (encrypted at rest via
// safeStorage) — never in the renderer, for http OR ws. A local unix-socket daemon needs no
// token (local trust). See electron/transport.cjs and electron/config.cjs.
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const path = require('node:path')
const { createTransport } = require('./transport.cjs')
const { resolveConfig, saveConfig, publicConfig, isConfigured } = require('./config.cjs')

let cfg = null          // resolved runtime config { socketPath } | { host, port, token }
let transport = null    // createTransport(cfg)
let bridge = null       // { wss, base } loopback WS bridge
let win = null

async function buildTransport() {
  if (bridge) { try { bridge.wss.close() } catch {} bridge = null }
  cfg = resolveConfig(app.getPath('userData'), safeStorage)
  transport = createTransport(cfg)
  bridge = await transport.startWsBridge()
  console.log('sesh: transport', publicConfig(cfg).mode, '→', publicConfig(cfg).target, '· ws bridge', bridge.base)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820,
    backgroundColor: '#11121a',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  })
  const url = process.env.SESH_UI_DEV_URL
  if (url) win.loadURL(url)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

// ── IPC: the seam the renderer's seshClient talks to ──
// HTTP — main does the request (token applied here for remote).
ipcMain.handle('sesh:get', (_e, p) => transport.request(p, 'GET'))
ipcMain.handle('sesh:post', (_e, p, body) => transport.request(p, 'POST', body))
// WS base — synchronous so seshClient.wsURL() can stay synchronous (new WebSocket(url)).
ipcMain.on('sesh:ws-base', (e) => { e.returnValue = bridge ? bridge.base : '' })
// Settings — read the token-free config view; write a new endpoint (token encrypted in main).
ipcMain.handle('sesh:get-config', () => publicConfig(cfg, isConfigured(app.getPath('userData'))))
ipcMain.handle('sesh:set-config', async (_e, input) => {
  saveConfig(app.getPath('userData'), safeStorage, input)
  await buildTransport()
  if (win) win.reload() // re-read the new ws base + re-poll through the new transport
  return publicConfig(cfg)
})

app.whenReady().then(async () => {
  await buildTransport() // bridge must exist before the window's preload runs sendSync('sesh:ws-base')
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { try { bridge?.wss.close() } catch {}; if (process.platform !== 'darwin') app.quit() })
