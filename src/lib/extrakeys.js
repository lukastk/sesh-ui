// Termux-style extra-keys row for the Android terminal/master views. The layout comes from the
// daemon's ui_config `extra_keys` (an opaque JSON string sesh just stores) — empty = no row. This
// module parses that JSON and turns a key press into the bytes to send to the pty over the terminal
// WebSocket, mirroring Termux's vocabulary so the user's existing termux config copies over verbatim.
//
// Layout JSON: an array of rows; each row an array of KEY SPECS, where a spec is one of:
//   - a string:    "ESC" | "TAB" | "ENTER" | "UP"/"DOWN"/"LEFT"/"RIGHT" | "HOME"/"END" |
//                  "PGUP"/"PGDN" | "BKSP"/"DEL" | sticky modifier "CTRL"/"ALT" |
//                  special "KEYBOARD" (re-open the soft keyboard) / "PASTE" (clipboard → pty) |
//                  or a literal character to type ("/", "-", "|", …)
//   - {macro, display}:  a space-separated chord SEQUENCE, e.g. "CTRL a a" → Ctrl+A then 'a'
//                        (modifiers apply to the following key); `display` is the button label
//   - {key, popup}:      tap sends `key`; long-press (swipe-up on termux) sends `popup`

const NAMED = {
  ESC: '\x1b', TAB: '\t', ENTER: '\r', RETURN: '\r', SPACE: ' ',
  BKSP: '\x7f', BACKSPACE: '\x7f', DEL: '\x1b[3~', DELETE: '\x1b[3~',
  UP: '\x1b[A', DOWN: '\x1b[B', RIGHT: '\x1b[C', LEFT: '\x1b[D',
  HOME: '\x1b[H', END: '\x1b[F', PGUP: '\x1b[5~', PGDN: '\x1b[6~',
}
// Keys that take an xterm CSI modifier param (1;<m>) when Ctrl/Alt are held.
const CSI_FINAL = { UP: 'A', DOWN: 'B', RIGHT: 'C', LEFT: 'D', HOME: 'H', END: 'F' }
const MOD_KEYS = { CTRL: 'ctrl', ALT: 'alt', SHIFT: 'shift', FN: 'fn' }
const SPECIALS = new Set(['KEYBOARD', 'PASTE'])

// Nicer button glyphs for the common named keys (falls back to the raw token).
const GLYPH = {
  ESC: 'ESC', TAB: 'TAB', ENTER: '⏎', RETURN: '⏎', UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→',
  HOME: 'HOME', END: 'END', PGUP: 'PGUP', PGDN: 'PGDN', BKSP: '⌫', BACKSPACE: '⌫', DEL: 'DEL',
  KEYBOARD: '⌨', PASTE: '⎘', CTRL: 'CTRL', ALT: 'ALT',
}

function ctrlChar(ch) { return String.fromCharCode(ch.toUpperCase().charCodeAt(0) & 0x1f) }

// Bytes for one key token (named key or literal char) under modifiers {ctrl, alt}.
export function keyBytes(token, mods = {}) {
  if (token == null || token === '') return ''
  const up = String(token).toUpperCase()
  const ctrl = !!mods.ctrl, alt = !!mods.alt
  if (CSI_FINAL[up]) {
    if (ctrl || alt) {
      const m = 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0)   // xterm: 1 + shift1 + alt2 + ctrl4
      return `\x1b[1;${m}${CSI_FINAL[up]}`
    }
    return NAMED[up]
  }
  if (up.length > 1 && NAMED[up] !== undefined) {        // a named non-char key (ESC/TAB/ENTER/…)
    return (alt ? '\x1b' : '') + NAMED[up]
  }
  const ch = String(token)                               // a literal character
  if (ctrl) return (alt ? '\x1b' : '') + ctrlChar(ch)
  if (alt) return '\x1b' + ch
  return ch
}

// Bytes for a macro: a whitespace-separated sequence where modifiers attach to the NEXT key,
// e.g. "CTRL a a" → \x01 then 'a'; "CTRL LEFT" → \x1b[1;5D.
export function macroBytes(macro) {
  let out = '', mods = {}
  for (const tok of String(macro).trim().split(/\s+/)) {
    const key = MOD_KEYS[tok.toUpperCase()]
    if (key) { mods[key] = true; continue }
    out += keyBytes(tok, mods)
    mods = {}
  }
  return out
}

// Parse the ui_config extra_keys JSON into rows of specs. Empty/invalid → [] (no row).
export function parseExtraKeys(json) {
  if (!json || !String(json).trim()) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter(Array.isArray) : []
  } catch { return [] }
}

// Classify a spec → { kind, label, ... } for the renderer.
//   kind: 'mod' (sticky CTRL/ALT) | 'special' (KEYBOARD/PASTE) | 'macro' | 'key' (+ optional popup)
export function describeKey(spec) {
  if (typeof spec === 'object' && spec) {
    if (spec.macro != null) return { kind: 'macro', label: spec.display ?? spec.macro, macro: spec.macro }
    if (spec.key != null) return { kind: 'key', label: spec.display ?? GLYPH[String(spec.key).toUpperCase()] ?? spec.key, key: spec.key, popup: spec.popup }
    return { kind: 'key', label: '?', key: '' }
  }
  const s = String(spec), up = s.toUpperCase()
  if (MOD_KEYS[up] && (up === 'CTRL' || up === 'ALT')) return { kind: 'mod', label: GLYPH[up] ?? s, mod: MOD_KEYS[up] }
  if (SPECIALS.has(up)) return { kind: 'special', label: GLYPH[up] ?? s, special: up }
  return { kind: 'key', label: GLYPH[up] ?? s, key: s }
}
