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

// ── thread hold (schema ≥34) ────────────────────────────────────────────────
// A held thread is parked until an ABSOLUTE instant. The daemon owns the live `on_hold` flag
// (on_hold_until_unix > its clock) and auto-expires it; the CLIENT owns the date math, computed
// against the USER's LOCAL clock — exactly like the sesh TUI (internal/tui/model.go).

// Midnight at the START of the next local day — the default hold deadline, so a parked thread
// returns to the active view tomorrow on its own (mirrors startOfTomorrowUnix in the TUI).
export function startOfTomorrowUnix() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 1)
  return Math.floor(d.getTime() / 1000)
}

// Parse a YYYY-MM-DD string as the START of that local day → unix, or null if malformed/invalid
// (mirrors the TUI's time.ParseInLocation; an out-of-range date like 2026-02-31 is rejected).
export function parseHoldDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((str || '').trim())
  if (!m) return null
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(y, mo - 1, da, 0, 0, 0, 0)
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null
  return Math.floor(d.getTime() / 1000)
}

// "YYYY-MM-DD" for a hold instant (the explicit-date prompt's prefill / a precise tooltip).
export function holdDateStr(unix) {
  if (!unix) return ''
  const d = new Date(unix * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Short badge text for a held row: "until Jun 27" (date known) or a bare "on hold". A leading "↑"
// marks a hold INHERITED from a held ancestor (effective deadline later than this thread's OWN) —
// mirrors the sesh TUI's HOLD column. Read `on_hold` for the live parked flag (already
// inheritance-aware) and `on_hold_effective_unix` for the effective deadline (schema ≥35).
export function holdUntilLabel(row) {
  if (!row?.on_hold) return ''
  const eff = row.on_hold_effective_unix
  if (!eff) return 'on hold'
  const inherited = eff > (row.on_hold_until_unix || 0)
  const d = new Date(eff * 1000)
  return `${inherited ? '↑ ' : ''}until ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

// Precise tooltip for a held row's badge: the effective date (YYYY-MM-DD) + an "(inherited…)" note
// when the hold comes from a held ancestor rather than this thread's own deadline.
export function holdTooltip(row) {
  if (!row?.on_hold) return ''
  const eff = row.on_hold_effective_unix
  if (!eff) return 'on hold'
  const inherited = eff > (row.on_hold_until_unix || 0)
  return `on hold until ${holdDateStr(eff)}${inherited ? ' (inherited from a held parent)' : ''}`
}
