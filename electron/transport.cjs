// The trusted transport layer, as a PURE-NODE factory (no Electron imports) so it can be
// unit-tested headlessly and reused. It is the ONLY place the bearer token lives at runtime.
//
// Two daemon transports, chosen by the resolved config:
//   - local  → a unix socket (no auth — local trust). { socketPath }
//   - remote → TCP with `Authorization: Bearer <token>`. { host, port, token }
//
// HTTP (get/post): main does the request; the renderer never sees the socket or the token.
//
// WebSocket (rpc/terminal): a renderer `new WebSocket()` CANNOT set headers and CANNOT dial a
// unix socket — so for a remote daemon the bearer auth cannot be a renderer header, and for a
// local daemon the renderer can't reach the socket at all. The fix is the same for both: main
// runs a loopback WS bridge. The renderer dials ws://127.0.0.1:<bridgePort><path>; main opens
// the UPSTREAM socket to the daemon (unix socketPath, or TCP+token) and pipes bytes both ways.
// The token stays in main for ws exactly as for http.

const http = require('node:http')
const { WebSocketServer, WebSocket } = require('ws')

// Build the http.request options for a daemon call. `path` is the daemon path WITHOUT /v1
// (the seshClient seam passes '/status', '/threads/grid', …); we prepend it here.
function httpOptions(cfg, path, method) {
  const headers = { 'Content-Type': 'application/json' }
  const base = { path: '/v1' + path, method, headers }
  if (cfg.host) {
    headers.Authorization = `Bearer ${cfg.token}`
    return { ...base, host: cfg.host, port: cfg.port }
  }
  return { ...base, socketPath: cfg.socketPath }
}

function createTransport(cfg) {
  const isRemote = !!cfg.host

  // One request/response call to the daemon → parsed JSON. Rejects loudly on a non-2xx
  // (carrying the daemon's error body) or a transport error — never a silent empty result.
  function request(path, method = 'GET', body) {
    return new Promise((resolve, reject) => {
      const req = http.request(httpOptions(cfg, path, method), (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`${path}: ${res.statusCode} ${data}`))
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

  // Open the UPSTREAM daemon WebSocket for a given request path (includes /v1 + query).
  function dialUpstream(reqPath) {
    if (isRemote) {
      return new WebSocket(`ws://${cfg.host}:${cfg.port}${reqPath}`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      })
    }
    // ws supports unix sockets via the `ws+unix://<socketPath>:<requestPath>` URL form.
    return new WebSocket(`ws+unix://${cfg.socketPath}:${reqPath}`)
  }

  // Start the loopback bridge. Resolves to its ws:// base (e.g. ws://127.0.0.1:49231) which
  // the renderer prepends the request path to. Binds 127.0.0.1 only (never exposed off-box).
  function startWsBridge() {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
      wss.on('error', reject)
      wss.on('connection', (client, req) => {
        const upstream = dialUpstream(req.url)
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

  return { request, startWsBridge, isRemote }
}

module.exports = { createTransport }
