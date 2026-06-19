// Electron main process — the trusted transport layer. STUB for Phase 0/2 (see PLAN.md).
//
// Design (do NOT put the token in the renderer):
//   - Local daemon  → http.request({ socketPath: '<SESH_HOME>/daemon.sock', path: '/v1'+p })
//                     (unix socket, no auth — local trust).
//   - Remote daemon → http.request to host:port with `Authorization: Bearer <token>`,
//                     the token loaded from the OS keychain (safeStorage), held only here.
//   - WebSockets    → either proxy the upgrade through here, or hand the renderer a URL the
//                     daemon will accept (token applied here). Keep the token in main.
//
// ipcMain.handle('sesh:get'|'sesh:post'|'sesh:wsURL', ...) implement the above.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  })
  // Dev: load the Vite server. Prod: load the built dist/index.html.
  const url = process.env.SESH_UI_DEV_URL
  if (url) win.loadURL(url)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
