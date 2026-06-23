// Pure render helpers. State honesty is the prime directive: the head/busy/attachment
// glyphs are a faithful 1:1 of the daemon's ThreadRow fields, and an unrecognized axis
// value (a version-skewed peer) renders as a loud "?" on exactly that axis — never guessed.

// Head glyph: ● live pane (headful) / ◌ no pane (headless) / ? unknown.
export function headGlyph(head) {
  return head === 'headful' ? '●' : head === 'headless' ? '◌' : '?'
}
// Busy glyph: ▶ a turn is executing / · idle / ? unknown.
export function busyGlyph(busy) {
  return busy === 'busy' ? '▶' : busy === 'idle' ? '·' : '?'
}
export function glyph(row) {
  return headGlyph(row.head) + busyGlyph(row.busy)
}

// A human label for the four (head × busy) states, with loud unknowns.
export function stateLabel(row) {
  if (row.head === 'headful') {
    if (row.busy === 'busy') return 'working'
    if (row.busy === 'idle') return 'needs input'
    return 'headful · ?'
  }
  if (row.head === 'headless') {
    if (row.busy === 'busy') return 'turn in flight'
    if (row.busy === 'idle') return 'idle'
    return 'headless · ?'
  }
  return '? · ?'
}

// Whether the composer should be disabled (a turn is in flight — matches the daemon's 409s).
export const isBusy = (row) => row?.busy === 'busy'

// The default chat surface for a thread, branched on its runtime shape (CLAUDE.md):
//   pi with a LIVE process → rpc streaming bubbles. pi's rpc-socket exists only while a pi
//     process is actually running — a live pane (headful) or a turn in flight (headless·busy).
//     An idle headless pi has NO live process and NO socket, so RPC would only ever error
//     there; its honest default is the transcript (and RPC stays selectable for when it runs).
//   headful claude/codex → xterm terminal
//   headless claude/codex (and idle headless pi) → transcript bubbles
export function surfaceFor(row) {
  if (!row) return 'none'
  if (row.agent_kind === 'pi' && (row.head === 'headful' || row.busy === 'busy')) return 'rpc'
  if (row.head === 'headful') return 'terminal'
  return 'headless'
}

// The surface to OPEN a thread on, honoring the user's ui_config.default_chat_view preference
// ('terminal' | 'transcript' | 'rpc'; default 'terminal'). The preference only takes effect when
// that surface is actually applicable to the thread; otherwise we fall back to surfaceFor's natural
// choice. 'transcript' maps to the 'headless' surface (always available); 'terminal' needs a headful
// pane; 'rpc' needs a pi agent. Code defensively: an absent/unknown pref behaves like 'terminal'.
export function defaultSurfaceFor(row, pref = 'terminal') {
  if (!row) return 'none'
  const want = pref === 'transcript' ? 'headless' : pref
  if (want === 'headless') return 'headless'
  if (want === 'terminal' && row.head === 'headful') return 'terminal'
  if (want === 'rpc' && row.agent_kind === 'pi') return 'rpc'
  return surfaceFor(row)
}

// Whether the RPC surface is even reachable right now (a live pi process). Used to label the
// RPC switcher honestly for an idle headless pi (it would refuse until a turn starts).
export const rpcLive = (row) => row?.agent_kind === 'pi' && (row.head === 'headful' || row.busy === 'busy')

// "live" / "12s ago" / "3m ago" / "2h ago" — relative freshness for mesh staleness.
export function ago(unix) {
  if (!unix) return 'never'
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix))
  if (s < 5) return 'live'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const shortId = (id) => (id ? id.slice(0, 8) : '')
