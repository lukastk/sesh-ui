// Endpoint + token resolution for the Electron main process. Precedence:
//   1. Env (dev convenience): SESH_API_ADDR (host:port) + SESH_API_TOKEN → remote;
//      else SESH_SOCKET_PATH → local.
//   2. Persisted config:  <userData>/endpoint.json (non-secret) + <userData>/token.enc
//      (the token, encrypted with Electron safeStorage — never stored in the clear).
//   3. Default: the local daemon's unix socket at ~/.sesh/daemon.sock (SESH_HOME-aware).
//
// The token NEVER leaves main: the renderer-facing view (publicConfig) reports only whether
// a token is set, never its value.

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

function defaultSocketPath() {
  const home = process.env.SESH_HOME || path.join(os.homedir(), '.sesh')
  return path.join(home, 'daemon.sock')
}

function endpointFile(userDataDir) { return path.join(userDataDir, 'endpoint.json') }
function tokenFile(userDataDir) { return path.join(userDataDir, 'token.enc') }

// Read the persisted non-secret endpoint config, or null.
function readEndpoint(userDataDir) {
  try { return JSON.parse(fs.readFileSync(endpointFile(userDataDir), 'utf8')) } catch { return null }
}

// Resolve the full runtime config { socketPath } | { host, port, token }. `safeStorage` is the
// Electron module (passed in so this file stays Electron-free and testable); may be undefined.
function resolveConfig(userDataDir, safeStorage) {
  // 1. env
  if (process.env.SESH_API_ADDR) {
    const [host, port] = process.env.SESH_API_ADDR.split(':')
    return { host, port: Number(port), token: process.env.SESH_API_TOKEN || '' }
  }
  if (process.env.SESH_SOCKET_PATH) return { socketPath: process.env.SESH_SOCKET_PATH }

  // 2. persisted
  const ep = readEndpoint(userDataDir)
  if (ep?.mode === 'remote' && ep.host) {
    let token = ''
    try {
      const enc = fs.readFileSync(tokenFile(userDataDir))
      token = safeStorage?.isEncryptionAvailable() ? safeStorage.decryptString(enc) : enc.toString('utf8')
    } catch {}
    return { host: ep.host, port: Number(ep.port), token }
  }
  if (ep?.mode === 'local' && ep.socketPath) return { socketPath: ep.socketPath }

  // 3. default
  return { socketPath: defaultSocketPath() }
}

// Persist a new endpoint config. For remote, the token is encrypted via safeStorage. Returns
// the resolved runtime config so main can rebuild its transport without a re-read.
function saveConfig(userDataDir, safeStorage, input) {
  fs.mkdirSync(userDataDir, { recursive: true })
  if (input.mode === 'remote') {
    fs.writeFileSync(endpointFile(userDataDir), JSON.stringify({ mode: 'remote', host: input.host, port: Number(input.port) }))
    if (input.token != null && input.token !== '') {
      const buf = safeStorage?.isEncryptionAvailable()
        ? safeStorage.encryptString(input.token)
        : Buffer.from(input.token, 'utf8')
      fs.writeFileSync(tokenFile(userDataDir), buf)
    }
    return { host: input.host, port: Number(input.port), token: input.token ?? '' }
  }
  // local
  const socketPath = input.socketPath || defaultSocketPath()
  fs.writeFileSync(endpointFile(userDataDir), JSON.stringify({ mode: 'local', socketPath }))
  return { socketPath }
}

// Has the user EXPLICITLY chosen an endpoint (env or a persisted config), vs. us falling back
// to the guessed default local socket? Drives the first-run "configure your connection" UX.
function isConfigured(userDataDir) {
  if (process.env.SESH_API_ADDR || process.env.SESH_SOCKET_PATH) return true
  return !!readEndpoint(userDataDir)
}

// The renderer-safe view of the current config — NO token value, only whether one is set.
function publicConfig(cfg, configured = true) {
  if (cfg.host) return { mode: 'remote', target: `${cfg.host}:${cfg.port}`, hasToken: !!cfg.token, editable: true, configured }
  return { mode: 'local', target: cfg.socketPath, hasToken: false, editable: true, configured }
}

module.exports = { resolveConfig, saveConfig, publicConfig, isConfigured, defaultSocketPath }
