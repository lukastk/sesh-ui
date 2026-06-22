// Configurable keyboard shortcuts. ONE reactive store — built-in defaults with localStorage-persisted
// overrides — mirroring fontscale.svelte.js. Combos are normalized strings like "mod+e" where "mod"
// is Cmd on macOS and Ctrl elsewhere (so a single binding works cross-platform). Screens match a
// KeyboardEvent against an action id with matchAction(); the Settings modal edits the bindings.
//
// Scoping: an action's `scope` is which surface owns it and groups the settings UI. Two actions may
// safely share a default combo when their scopes never coexist — threads.new and tickets.new are
// both "mod+n", but only one of those screens is ever mounted, so only its window listener is live.

const LS = 'seshui.keymap'
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

// The catalog of every bindable action. Order = display order in settings.
export const KEYMAP_DEFS = [
  { id: 'nav.threads', label: 'Go to Threads', scope: 'Global', default: 'mod+1' },
  { id: 'nav.tickets', label: 'Go to Tickets', scope: 'Global', default: 'mod+2' },
  { id: 'nav.machines', label: 'Go to Machines', scope: 'Global', default: 'mod+3' },
  { id: 'nav.automation', label: 'Go to Automation', scope: 'Global', default: 'mod+4' },
  { id: 'nav.master', label: 'Go to Master', scope: 'Global', default: 'mod+5' },
  { id: 'app.settings', label: 'Open settings', scope: 'Global', default: 'mod+,' },
  { id: 'threads.toggleView', label: 'Toggle transcript/terminal (pi: RPC/terminal)', scope: 'Threads', default: 'mod+e' },
  { id: 'threads.focusFilter', label: 'Focus thread filter', scope: 'Threads', default: 'mod+f' },
  { id: 'threads.new', label: 'New thread', scope: 'Threads', default: 'mod+n' },
  { id: 'tickets.new', label: 'New ticket', scope: 'Tickets', default: 'mod+n' },
  { id: 'tickets.focusFilter', label: 'Focus ticket filter', scope: 'Tickets', default: 'mod+f' },
]

const DEFAULTS = Object.fromEntries(KEYMAP_DEFS.map((d) => [d.id, d.default]))

function load() { try { return JSON.parse(localStorage.getItem(LS) || '{}') } catch { return {} } }

// id → combo. Defaults overlaid with the user's saved overrides.
export const keymap = $state({ ...DEFAULTS, ...load() })

function persist() {
  // Store only diffs from the defaults, so a future change to a default still reaches users who
  // never rebound that action.
  const diff = {}
  for (const [id, combo] of Object.entries(keymap)) if (combo !== DEFAULTS[id]) diff[id] = combo
  try { localStorage.setItem(LS, JSON.stringify(diff)) } catch {}
}

export function setBinding(id, combo) { keymap[id] = combo; persist() }
export function resetBinding(id) { keymap[id] = DEFAULTS[id]; persist() }
export function resetAllBindings() { for (const id of Object.keys(DEFAULTS)) keymap[id] = DEFAULTS[id]; persist() }
export const defaultBinding = (id) => DEFAULTS[id]

// Normalize a KeyboardEvent to a combo string ("mod+e", "mod+,", "shift+enter"). Returns null for a
// bare modifier press (so a binding-capture UI waits for the real key).
export function comboFromEvent(e) {
  const k = e.key
  if (k === 'Meta' || k === 'Control' || k === 'Alt' || k === 'Shift') return null
  const parts = []
  if (e.metaKey || e.ctrlKey) parts.push('mod')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(k.toLowerCase())
  return parts.join('+')
}

// Does this event match the binding for action `id`?
export function matchAction(e, id) {
  const combo = keymap[id]
  return !!combo && comboFromEvent(e) === combo
}

// Human-readable combo for the UI: "mod+e" → "⌘E" (mac) / "Ctrl+E".
export function fmtCombo(combo) {
  if (!combo) return '—'
  const sym = (p) => {
    if (p === 'mod') return isMac ? '⌘' : 'Ctrl'
    if (p === 'shift') return isMac ? '⇧' : 'Shift'
    if (p === 'alt') return isMac ? '⌥' : 'Alt'
    if (p === 'enter') return '⏎'
    if (p === ' ') return 'Space'
    return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)
  }
  return combo.split('+').map(sym).join(isMac ? '' : '+')
}
