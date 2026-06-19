// seshClient — the ONE door to the sesh daemon API. Every component goes through this;
// no raw fetch/WebSocket elsewhere. It hides the transport behind get/post/wsURL:
//
//   - web/dev:  goes through the Vite dev proxy (which injects the bearer token, so the
//               renderer never holds it). See vite.config.js.
//   - electron: window.sesh.* (contextBridge → main process: unix socket local / TCP+token
//               remote, token only in main).  [Phase 0 — to implement]
//   - android:  native HTTP plugin.  [Phase 3]
//
// Detection: if the Electron preload exposed `window.sesh`, use it; else assume web/dev.

const electron = typeof window !== 'undefined' && window.sesh

async function webGet(path) {
  const r = await fetch('/api' + path)
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text().catch(() => '')}`)
  return r.json()
}
async function webPost(path, body) {
  const r = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text().catch(() => '')}`)
  return r.json()
}

export const sesh = {
  transport: electron ? 'electron' : 'web',

  // GET /v1<path>  → parsed JSON
  get(path) {
    return electron ? window.sesh.get(path) : webGet(path)
  },
  // POST /v1<path> with a JSON body → parsed JSON
  post(path, body) {
    return electron ? window.sesh.post(path, body) : webPost(path, body)
  },
  // A WebSocket URL for a streaming endpoint (the two daemon WS endpoints:
  // /v1/threads/rpc, /v1/threads/terminal). In web/dev the Vite proxy injects the token;
  // in Electron the main process supplies an authenticated URL/socket.
  wsURL(path) {
    if (electron) return window.sesh.wsURL(path)
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}${path}`
  },
}

// Convenience wrappers for the endpoints the UI uses most. Add to these as screens land.
export const api = {
  status: () => sesh.get('/status'),
  health: () => sesh.get('/health'),
  grid: () => sesh.get('/threads/grid'),
  mesh: () => sesh.get('/mesh'),
  threadNew: (req) => sesh.post('/threads', req),
  // tickets
  ticketsAll: () => sesh.get('/tickets/list-all'),
  // streaming endpoints return WS URLs, not data:
  rpcURL: (id) => sesh.wsURL(`/v1/threads/rpc?id=${encodeURIComponent(id)}`),
  terminalURL: (id, cols, rows) =>
    sesh.wsURL(`/v1/threads/terminal?id=${encodeURIComponent(id)}&cols=${cols}&rows=${rows}`),
}
