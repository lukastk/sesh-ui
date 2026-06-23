// Electron main process — the trusted transport layer for the renderer.
//
// The renderer reaches the daemon ONLY through here: ipcRenderer.invoke('sesh:get'|'sesh:post')
// for HTTP, and a loopback WS bridge (its base handed to the renderer synchronously) for the
// rpc/terminal WebSockets. The bearer token lives ONLY in main (encrypted at rest via
// safeStorage) — never in the renderer, for http OR ws. A local unix-socket daemon needs no
// token (local trust). See electron/transport.cjs and electron/config.cjs.
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron')
const path = require('node:path')
const transport = require('./transport.cjs')
const { peerConfig, peerMachines } = require('./peers.cjs')
const { resolveConfig, saveConfig, publicConfig, isConfigured } = require('./config.cjs')

let cfg = null              // the CONNECTED daemon's config { socketPath } | { host, port, token }
let connectedMachine = null // its machine name (so we can tell local vs a peer target)
let bridge = null           // { wss, base } loopback WS bridge
let win = null

// Resolve the daemon cfg for a target machine: '' / null / the connected machine → the connected
// daemon; any other machine → its peer endpoint from peers.json (token read in main). null if we
// have no dial-able endpoint for it (the renderer then keeps the cross-machine notice).
function resolveCfgForMachine(machine) {
  if (!machine || machine === connectedMachine) return cfg
  const pc = peerConfig(machine)
  return pc ? { host: pc.host, port: pc.port, token: pc.token } : null
}

async function buildTransport() {
  if (bridge) { try { bridge.wss.close() } catch {} bridge = null }
  cfg = resolveConfig(app.getPath('userData'), safeStorage)
  bridge = await transport.startWsBridge(resolveCfgForMachine)
  // Learn the connected daemon's machine name so per-thread routing knows what "local" is.
  try { connectedMachine = (await transport.request(cfg, '/status')).machine } catch { connectedMachine = null }
  console.log('sesh: transport', publicConfig(cfg).mode, '→', publicConfig(cfg).target,
    '· machine', connectedMachine, '· peers', peerMachines().join(',') || '(none)', '· ws bridge', bridge.base)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820,
    backgroundColor: '#11121a',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  })
  openExternalLinks(win.webContents)
  const url = process.env.SESH_UI_DEV_URL
  if (url) win.loadURL(url)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

// External links (markdown bubbles, anywhere) must open in the user's DEFAULT browser — never
// navigate/replace the app window (a bare <a href> click would otherwise load the URL INTO the
// BrowserWindow, blowing away the app). The renderer's capture-phase handler (src/lib/links.js) is
// the primary path; this is the backstop that catches anything it misses (window.open, modifier-
// clicks). Only http(s) is externalized — the app's own file:// / dev-server nav is left alone.
function openExternalLinks(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    if (!/^https?:\/\//i.test(url)) return
    const devURL = process.env.SESH_UI_DEV_URL
    if (devURL && url.startsWith(new URL(devURL).origin)) return // the dev server itself — real app nav
    e.preventDefault()
    shell.openExternal(url)
  })
}

// ── IPC: the seam the renderer's seshClient talks to ──
// HTTP — main does the request (token applied here for remote). We resolve a STRUCTURED result
// ({ok} | {error}) rather than letting the promise reject: a rejected ipcMain.handle handler is
// logged by Electron itself as "Error occurred in handler for 'sesh:get'", which floods the
// console with EXPECTED 4xx (e.g. a never-run thread's 404 "no transcript"). preload.cjs unwraps
// this back into a resolve/throw, so the renderer's loud-error contract is unchanged. Here we log
// ONLY genuine failures (transport errors / 5xx) — never an expected client-side 4xx.
async function doRequest(p, method, body, machine) {
  const target = resolveCfgForMachine(machine)
  if (!target) return { ok: false, error: `no dial-able endpoint for machine "${machine}"`, status: 0 }
  try {
    return { ok: true, data: await transport.request(target, p, method, body) }
  } catch (e) {
    const status = e.status ?? 0
    if (!(status >= 400 && status < 500)) console.error('sesh transport error:', machine || 'local', p, '·', e.message)
    return { ok: false, error: e.message, status }
  }
}
// The optional 4th arg is the target machine for cross-machine chat ('' / undefined → local).
ipcMain.handle('sesh:get', (_e, p, machine) => doRequest(p, 'GET', undefined, machine))
ipcMain.handle('sesh:post', (_e, p, body, machine) => doRequest(p, 'POST', body, machine))
// Peer info for the renderer: which machine we're connected to + the machines we can dial for chat.
ipcMain.handle('sesh:peer-info', () => ({ connected: connectedMachine, peers: peerMachines() }))
// Open a URL in the user's default browser (the renderer routes external link clicks here).
ipcMain.handle('sesh:open-external', (_e, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url) })
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
