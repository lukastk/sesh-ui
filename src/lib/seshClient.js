// seshClient — the ONE door to the sesh daemon API. Every component goes through this;
// no raw fetch/WebSocket lives anywhere else (a standing project rule). It hides the
// transport behind get/post/wsURL:
//
//   - web/dev:  goes through the Vite dev proxy (which injects the bearer token, so the
//               renderer never holds it). See vite.config.js.
//   - electron: window.sesh.* (contextBridge → main process: unix socket local / TCP+token
//               remote, token only in main).  [Phase 2]
//   - android:  a native bridge `window.SeshNative` (a Capacitor plugin) does native HTTP to a
//               remote hub daemon over tailscale; the bearer token lives in the Android Keystore,
//               never the WebView — exactly mirroring electron's main-process `window.sesh`. The
//               plugin exposes the SAME shape (get/post/wsBase/peerInfo/getConfig/setConfig). [Phase 3]
//
// Detection: Electron preload `window.sesh` → electron; native `window.SeshNative` → android; else web/dev.

const electron = typeof window !== 'undefined' && window.sesh
const native = typeof window !== 'undefined' && window.SeshNative   // Android (Capacitor) native bridge

// Build a /v1 query string from an object, dropping null/undefined/'' values.
function qs(params) {
  if (!params) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? '?' + s : ''
}

// The daemon reads its boolean query flags as the literal "1" (Query().Get(k) == "1"), NOT
// "true"/"false" — so a flag must be sent as 1 when on and OMITTED when off. (Sending "true"
// silently reads as off: that's why the all-machines grid + the archived toggle did nothing.)
const flag = (b) => (b ? 1 : undefined)

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
  transport: electron ? 'electron' : native ? 'android' : 'web',

  // GET /v1<path>  → parsed JSON. `machine` (optional) routes to a peer daemon for cross-machine
  // chat (Electron only — main holds the peer token); web/dev is a fixed single-daemon proxy.
  get(path, machine) {
    if (electron) return window.sesh.get(path, machine)
    if (native) return window.SeshNative.get(path, machine)
    return webGet(path)
  },
  // POST /v1<path> with a JSON body → parsed JSON. `machine` as for get().
  post(path, body, machine) {
    if (electron) return window.sesh.post(path, body, machine)
    if (native) return window.SeshNative.post(path, body, machine)
    return webPost(path, body)
  },
  // A WebSocket URL for a streaming endpoint (the two daemon WS endpoints:
  // /v1/threads/rpc, /v1/threads/terminal). In web/dev the Vite proxy injects the token; in
  // Electron the renderer dials main's loopback bridge (wsBase), which injects auth upstream —
  // so the token stays out of the renderer for ws exactly as for http.
  wsURL(path, machine) {
    const suffix = machine ? `&__machine=${encodeURIComponent(machine)}` : ''
    if (electron) return window.sesh.wsBase + path + suffix
    if (native) return window.SeshNative.wsBase + path + suffix
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}${path}`
  },

  // Cross-machine reach: the machine we're connected to + the peer machines we can dial for chat.
  // Web/dev can't dial peers (the proxy is fixed), so it reports none.
  peerInfo() {
    if (electron) return window.sesh.peerInfo()
    if (native) return window.SeshNative.peerInfo()
    return Promise.resolve({ connected: null, peers: [] })
  },

  // Connection settings (endpoint + token). In Electron these round-trip to the main process
  // (the token is write-only — getConfig never returns its value). In web/dev the endpoint is
  // the fixed Vite proxy, so the config is read-only.
  getConfig() {
    if (electron) return window.sesh.getConfig()
    if (native) return window.SeshNative.getConfig()
    return Promise.resolve({ mode: 'web', target: 'Vite dev proxy', hasToken: false, editable: false })
  },
  setConfig(cfg) {
    if (electron) return window.sesh.setConfig(cfg)
    if (native) return window.SeshNative.setConfig(cfg)
    return Promise.reject(new Error('endpoint is fixed in web/dev mode (configure vite.config.js)'))
  },
}

// Named wrappers for every endpoint a screen touches. The daemon owns naming/routing/state;
// these just shape the request/response — no client-side re-derivation of daemon logic.
export const api = {
  // ── daemon / mesh ────────────────────────────────────────────────────────
  status: () => sesh.get('/status'),
  health: () => sesh.get('/health'),
  mesh: () => sesh.get('/mesh'),

  // ── ui-config (per-daemon UI prefs; <SESH_HOME>/ui_config.toml, daemon schema ≥24) ─────────
  // GET → {schema, ui_config:{collapse_parents,…}} (defaults applied); POST replaces + returns it.
  // `machine` (optional) reads the config from a PEER daemon (Electron) — used by the Master screen
  // to discover whether master_command is set on the machine whose cockpit you're opening.
  uiConfigGet: (machine) => sesh.get('/ui-config', machine),
  uiConfigSet: (cfg) => sesh.post('/ui-config', cfg),

  // ── peers (mesh membership; /v1/peers CRUD, daemon schema ≥22) ─────────────
  peers: () => sesh.get('/peers'),
  peerAdd: (peer) => sesh.post('/peers', peer),
  peerRemove: (machine) => sesh.post('/peers/remove', { machine }),

  // ── threads: grid & lifecycle ────────────────────────────────────────────
  grid: (opts = {}) => sesh.get('/threads/grid' + qs({ archived: flag(opts.archived), 'all-machines': flag(opts.allMachines) })),
  threadList: (opts = {}) => sesh.get('/threads' + qs({ archived: flag(opts.archived), 'all-machines': flag(opts.allMachines) })),
  threadStatus: (id, machine) => sesh.get('/threads/status' + qs({ id }), machine),
  threadNew: (req, machine) => sesh.post('/threads', req, machine),
  // Lifecycle verbs take the thread's owning `machine` (optional) — without it a verb on a
  // cross-machine thread 404s on the connected daemon (the daemon doesn't fan verbs out).
  resume: (id, machine) => sesh.post('/threads/resume', { id }, machine),
  headful: (id, machine) => sesh.post('/threads/headful', { id }, machine),
  stop: (id, machine) => sesh.post('/threads/stop', { id }, machine),
  archive: (id, archived, machine) => sesh.post('/threads/archive', { id, archived }, machine),
  rename: (id, name, machine) => sesh.post('/threads/rename', { id, name }, machine),
  reparent: (id, parent, machine) => sesh.post('/threads/reparent', { id, parent }, machine),
  del: (id, force, machine) => sesh.post('/threads/delete', { id, force }, machine),
  notify: (id, on, machine) => sesh.post('/threads/notify', { id, on }, machine),
  // Park a thread until an ABSOLUTE instant (0 = clear). The daemon is a pure setter — the CLIENT
  // supplies on_hold_until_unix (compute "start of tomorrow" in LOCAL time); the owning daemon
  // derives the live `on_hold` flag against ITS clock and auto-expires it. Routes cross-machine like
  // archive/notify. A pre-34 daemon 404s this route loudly (no silent swallow). (daemon schema ≥34)
  hold: (id, onHoldUntilUnix, machine) => sesh.post('/threads/hold', { id, on_hold_until_unix: onHoldUntilUnix }, machine),

  // ── threads: chat ────────────────────────────────────────────────────────
  // `machine` (optional) dials the thread's OWNING daemon for a cross-machine thread (Electron).
  transcript: (id, tail = 200, machine) => sesh.get('/threads/transcript' + qs({ id, tail }), machine),
  send: (id, text, machine) => sesh.post('/threads/send', { id, text }, machine),
  // `model` (optional) overrides the thread's pinned model for THIS headless turn only (pass-through).
  sendHeadless: (id, text, machine, model) => sesh.post('/threads/send-headless', { id, text, model: model || undefined }, machine),
  headlessReply: (id, machine) => sesh.get('/threads/headless-reply' + qs({ id }), machine),
  capture: (id, lines = 0, machine) => sesh.get('/threads/capture' + qs({ id, lines }), machine),

  // ── filesystem picker (cwd) ──────────────────────────────────────────────
  // `machine` (optional) lists on the TARGET daemon (a ~-cwd resolves portably on the owner).
  fsList: (path, machine) => sesh.get('/fs/list' + qs({ path }), machine),

  // ── plugins (daemon command-providers; schema ≥29) ─────────────────────────
  // The daemon runs manifest-declared commands ON ITS OWN HOST and shapes them for the UI.
  // Both route by `machine` (optional) — plugins are PER-MACHINE (e.g. the boxes on the target
  // daemon), so the cwd picker passes the new-thread target machine through to both.
  plugins: (machine) => sesh.get('/plugins', machine),
  // Run one capability: list-kind returns { items: [...] }; action-kind runs the command and
  // substitutes its `{field}` placeholders. The daemon wants the field values under `fields`
  // (the run handler decodes strictly: a bare {name:…} 400s with "unknown field").
  pluginRun: (name, capability, fields, machine) =>
    sesh.post(`/plugins/${encodeURIComponent(name)}/${encodeURIComponent(capability)}`, { fields: fields || {} }, machine),

  // ── tickets ──────────────────────────────────────────────────────────────
  // Ticket ops take the ticket's owning `machine` (optional) — a remote ticket 404s without it.
  ticketsAll: () => sesh.get('/tickets/list-all'),
  ticketGet: (id, machine) => sesh.get('/tickets/get' + qs({ id }), machine),
  ticketCreate: (name, prompt) => sesh.post('/tickets', { name, prompt }),
  ticketSet: (id, fields, machine) => sesh.post('/tickets/set', { id, ...fields }, machine),
  ticketSetStatus: (id, status, threadId, note, machine) =>
    sesh.post('/tickets/status', { id, status, thread_id: threadId || undefined, note: note || undefined }, machine),
  ticketDelete: (id, machine) => sesh.post('/tickets/delete', { id }, machine),
  ticketSendPrompt: (id, machine) => sesh.post('/tickets/send-prompt', { id }, machine),
  ticketUnbind: (id, machine) => sesh.post('/tickets/unbind', { id }, machine),
  ticketFind: (id) => sesh.get('/tickets/find' + qs({ id })),                 // mesh-wide lookup by id (fan-out)
  ticketMove: (id, to, from) => sesh.post('/tickets/move', { id, to, from: from || undefined }),

  // ── threads: tags ─────────────────────────────────────────────────────────
  tag: (id, add, remove, machine) => sesh.post('/threads/tag', { id, add: add || undefined, remove: remove || undefined }, machine),

  // ── automation: hooks ──────────────────────────────────────────────────────
  hooks: () => sesh.get('/hooks'),
  hookMute: (name, muted) => sesh.post('/hooks/mute', { name, muted }),
  hookTest: (name, threadId) => sesh.post('/hooks/test', { name, thread_id: threadId || undefined }),

  // ── automation: subscriptions (agent-to-agent edges) ───────────────────────
  subscriptions: () => sesh.get('/subscriptions'),
  subscribe: (subscriber, subscribee, allowCycle) =>
    sesh.post('/subscriptions', { subscriber, subscribee, allow_cycle: allowCycle || undefined }),
  unsubscribe: (subscriber, subscribee) => sesh.post('/subscriptions/remove', { subscriber, subscribee }),

  // ── blobs ────────────────────────────────────────────────────────────────
  // `machine` (optional) targets the thread's OWNING machine's blob store for cross-machine chat.
  blobAdd: (name, base64, machine) => sesh.post('/blobs', { name, data: base64 }, machine),
  // The blob's absolute path ON THE SERVING DAEMON — what headful chats insert (the live agent
  // reads the file from this path; @blob() tokens only expand on send/send-headless, not headful).
  blobPath: (hash, machine) => sesh.get('/blobs/path' + qs({ hash }), machine),

  // ── streaming endpoints (return WS URLs, not data) ───────────────────────
  // `machine` (optional) routes the WS through main's bridge to the thread's owning daemon.
  rpcURL: (id, machine) => sesh.wsURL(`/v1/threads/rpc?id=${encodeURIComponent(id)}`, machine),
  terminalURL: (id, cols, rows, machine) =>
    sesh.wsURL(`/v1/threads/terminal?id=${encodeURIComponent(id)}&cols=${cols}&rows=${rows}`, machine),
  // The master-cockpit terminal WS (daemon runs ui_config.master_command in a pty; schema ≥28).
  // Same pty<->WS protocol as the thread terminal; `machine` routes to that peer's master (the
  // wsURL seam injects the token + __machine for every transport).
  masterURL: (cols, rows, machine) => sesh.wsURL(`/v1/master/terminal?cols=${cols}&rows=${rows}`, machine),
}

export const TICKET_STATUSES = ['triage', 'ready', 'active', 'done', 'dropped']
export const TICKET_COLORS = {
  triage: '#565f89', ready: '#7aa2f7', active: '#e0af68', done: '#9ece6a', dropped: '#f7768e',
}
