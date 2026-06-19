// The trusted transport layer, as a PURE-NODE module (no Electron imports) so it can be unit-tested
// headlessly and reused. It is the ONLY place the bearer token lives at runtime.
//
// A daemon transport is described by a cfg:
//   - local  → a unix socket (no auth — local trust).        { socketPath }
//   - remote → TCP with `Authorization: Bearer <token>`.     { host, port, token }
//
// Every call takes its cfg EXPLICITLY, because the app talks to one daemon for most things but must
// dial a thread's OWNING daemon for cross-machine chat (rpc/terminal/transcript). main.cjs resolves
// the cfg per request/connection (local vs a peer from peers.cjs) and passes it in.
//
// HTTP (request): main does the request; the renderer never sees the socket or the token.
//
// WebSocket (rpc/terminal): a renderer `new WebSocket()` CANNOT set headers and CANNOT dial a unix
// socket. So main runs a loopback WS bridge: the renderer dials ws://127.0.0.1:<port><path>, and the
// bridge opens the UPSTREAM socket (unix, or TCP+token) and pipes bytes both ways. The upstream cfg
// is chosen per-connection from the `__machine` query param via the resolveCfg callback, so a remote
// thread's socket is dialed on its owning daemon — the token stays in main for ws exactly as for http.

const http = require('node:http')
const { WebSocketServer, WebSocket } = require('ws')

// Build the http.request options for a daemon call. `path` is the daemon path WITHOUT /v1.
function httpOptions(cfg, path, method) {
  const headers = { 'Content-Type': 'application/json' }
  const base = { path: '/v1' + path, method, headers }
  if (cfg.host) {
    headers.Authorization = `Bearer ${cfg.token}`
    return { ...base, host: cfg.host, port: cfg.port }
  }
  return { ...base, socketPath: cfg.socketPath }
}

// One request/response call to a SPECIFIC daemon cfg → parsed JSON. Rejects loudly on a non-2xx
// (carrying the status on err.status) or a transport error — never a silent empty result.
function request(cfg, path, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = http.request(httpOptions(cfg, path, method), (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`${path}: ${res.statusCode} ${data}`)
          err.status = res.statusCode
          reject(err)
          return
        }
        try { resolve(data ? JSON.parse(data) : {}) }
        catch (e) { reject(new Error(`${path}: bad JSON: ${e.message}`)) }
      })
    })
    req.on('error', (e) => reject(new Error(`${path}: ${e.message}`)))
    if (method !== 'GET') req.write(JSON.stringify(body ?? {}))
    req.end()
  })
}

// Open the UPSTREAM daemon WebSocket for a given cfg + request path (includes /v1 + query).
function dialUpstream(cfg, reqPath) {
  if (cfg.host) {
    return new WebSocket(`ws://${cfg.host}:${cfg.port}${reqPath}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    })
  }
  // ws supports unix sockets via the `ws+unix://<socketPath>:<requestPath>` URL form.
  return new WebSocket(`ws+unix://${cfg.socketPath}:${reqPath}`)
}

// Start the loopback bridge. `resolveCfg(machine)` returns the upstream cfg for a target machine
// (null '' → the local/connected daemon; a peer name → its dial config) or null if not dial-able.
// Resolves to its ws:// base which the renderer prepends the request path to. 127.0.0.1 only.
function startWsBridge(resolveCfg) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    wss.on('error', reject)
    wss.on('connection', (client, req) => {
      // The renderer encodes the target machine as a `__machine` query param; strip it before
      // dialing upstream (the daemon doesn't expect it) and resolve the owning daemon's cfg.
      let cfg, reqPath
      try {
        const u = new URL(req.url, 'http://x')
        const machine = u.searchParams.get('__machine')
        u.searchParams.delete('__machine')
        reqPath = u.pathname + (u.search || '')
        cfg = resolveCfg(machine)
      } catch {
        try { client.close(1011, 'bad route') } catch {}
        return
      }
      if (!cfg) { try { client.close(1011, 'no endpoint for machine') } catch {}; return }

      const upstream = dialUpstream(cfg, reqPath)
      const pending = [] // client frames that arrive before upstream is open
      let open = false

      upstream.on('open', () => { open = true; for (const [d, b] of pending) upstream.send(d, { binary: b }); pending.length = 0 })
      upstream.on('message', (data, isBinary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary }) })
      upstream.on('close', (code, reason) => { try { client.close(code >= 1000 && code <= 4999 ? code : 1000, reason) } catch { try { client.close() } catch {} } })
      upstream.on('error', () => { try { client.close(1011, 'upstream error') } catch {} })

      client.on('message', (data, isBinary) => { if (open && upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary }); else pending.push([data, isBinary]) })
      client.on('close', () => { try { upstream.close() } catch {} })
      client.on('error', () => { try { upstream.close() } catch {} })
    })
    wss.on('listening', () => resolve({ wss, base: `ws://127.0.0.1:${wss.address().port}` }))
  })
}

module.exports = { request, dialUpstream, startWsBridge }
