// App-wide UI scale + a SEPARATE terminal font size, persisted to localStorage. One reactive store
// so every driver shares it: the desktop Cmd/Ctrl +/- / on-screen buttons AND the Android
// pinch-to-zoom (separate branch) both call setScale — keep this module the single source of truth.
//
//  - scale: a whole-UI zoom factor (applied as `zoom: var(--font-scale)` on .app). 1 = default.
//  - term:  the xterm.js fontSize in px — the terminal is kept crisp/independent of the app zoom
//           (Terminal.svelte counter-zooms its wrapper), so this is the ONLY control of its size.

const LS = 'seshui.fontscale'

const clampScale = (v) => Math.min(2.2, Math.max(0.6, Number(v) || 1))
const clampTerm = (v) => Math.min(30, Math.max(8, Math.round(Number(v) || 13)))

function load() { try { return JSON.parse(localStorage.getItem(LS) || '{}') } catch { return {} } }
const init = load()

export const fontScale = $state({
  scale: clampScale(init.scale ?? 1),
  term: clampTerm(init.term ?? 13),
})

function persist() {
  try { localStorage.setItem(LS, JSON.stringify({ scale: fontScale.scale, term: fontScale.term })) } catch {}
}

// App UI scale
export function setScale(v) { fontScale.scale = clampScale(v); persist() }
export function bumpScale(delta) { setScale(Math.round((fontScale.scale + delta) * 100) / 100) }
export function resetScale() { setScale(1) }

// Terminal font size (independent of the app scale)
export function setTerm(v) { fontScale.term = clampTerm(v); persist() }
export function bumpTerm(delta) { setTerm(fontScale.term + delta) }
