// Peer-daemon discovery for cross-machine chat. The app talks to ONE daemon, but a thread can live
// on ANOTHER machine; to chat with it (rpc / terminal / transcript) we dial that thread's OWNING
// daemon directly. `~/.sesh/peers.json` maps machine → api_addr (host:port) + a bearer token (inline
// or in api_token_file). The token is read HERE in main and never reaches the renderer. The file is
// re-read on mtime change so edits to peers.json are picked up without a restart.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

function peersPath() {
  const home = process.env.SESH_HOME || path.join(os.homedir(), '.sesh')
  return path.join(home, 'peers.json')
}

let cache = { mtime: -1, map: new Map() }

function loadPeers() {
  const p = peersPath()
  let st
  try { st = fs.statSync(p) } catch { cache = { mtime: -1, map: new Map() }; return cache.map }
  if (st.mtimeMs === cache.mtime) return cache.map
  const map = new Map()
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'))
    for (const [machine, peer] of Object.entries(doc.peers || {})) {
      if (!peer.api_addr) continue // only http-reachable peers are dial-able from the client
      const i = peer.api_addr.lastIndexOf(':')
      const host = peer.api_addr.slice(0, i)
      const port = Number(peer.api_addr.slice(i + 1))
      let token = peer.api_token || ''
      if (!token && peer.api_token_file) {
        try { token = fs.readFileSync(peer.api_token_file, 'utf8').trim() } catch {}
      }
      map.set(machine, { host, port, token })
    }
  } catch {}
  cache = { mtime: st.mtimeMs, map }
  return map
}

// The peer transport config { host, port, token } for a machine, or null if we have no dial-able
// endpoint for it (unknown machine, or a peer configured for ssh-only with no api_addr).
function peerConfig(machine) {
  return loadPeers().get(machine) || null
}

// The machines we have a dial-able http endpoint for (drives the UI's "can I chat with this remote
// thread?" decision).
function peerMachines() {
  return [...loadPeers().keys()]
}

module.exports = { peerConfig, peerMachines, peersPath }
