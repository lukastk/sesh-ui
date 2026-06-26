// Purely-client UI preferences (NOT the per-daemon ui_config) — persisted to localStorage and
// reactive via runes, like fontscale.svelte.js. These are device/app-local choices that have no
// business round-tripping to a daemon.
import { sesh } from './seshClient.js'

const KEY = 'seshui.prefs'
function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
const saved = load()

export const prefs = $state({
  // Auto-focus the chat composer when a thread opens. On a phone that pops the soft keyboard the
  // instant you open a thread (covering half the screen before you've chosen to type), so it's OFF
  // by default on Android and ON elsewhere (a desktop has a real keyboard — focusing is a freebie).
  // A null saved value means "never set" → fall back to the per-transport default.
  composerAutofocus: saved.composerAutofocus ?? (sesh.transport !== 'android'),
  // Terminal touch-scroll sensitivity (a multiplier on finger-pixels → wheel deltaY in
  // Terminal.svelte's onTouchMove). 1 = the raw 1:1 mapping, which felt sluggish on Android; default
  // higher so a swipe travels further. Device-local — a phone and a laptop want different speeds.
  termScrollSensitivity: saved.termScrollSensitivity ?? 3,
})

function persist() { try { localStorage.setItem(KEY, JSON.stringify($state.snapshot(prefs))) } catch {} }
export function setPref(key, val) { prefs[key] = val; persist() }
