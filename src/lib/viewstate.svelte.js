// Per-screen view memory. App.svelte's top-nav swaps screens with `{#if screen === …}<Screen/>`,
// which UNMOUNTS the previous screen component — destroying all of its `$state`. So re-entering a
// page (Threads → Tickets → Threads) would otherwise start blank: no selection, scrolled to the top.
// These module-scoped maps outlive any single mount, so each screen saves its selection/filter on
// change and restores it on mount, landing you back where you were. (Purely client-side, in-memory:
// it survives navigation within a session, not a reload — that's the scope of the ask.)

const fields = new Map()   // screen key -> last-saved plain object of view fields
const scrolls = new Map()  // scroll key  -> last-saved scrollTop

// Save/restore a screen's view fields (selection, filter, toggles…). `loadView` returns {} the first
// time, so callers spread it over their defaults; `saveView` merges a patch into the stored object.
export function loadView(screen) { return fields.get(screen) || {} }
export function saveView(screen, patch) { fields.set(screen, { ...(fields.get(screen) || {}), ...patch }) }

// Svelte action: remember a scrollable element's offset across mounts under `key`. The list's rows
// usually arrive a tick or two AFTER mount (first poll), so a plain mount-time set would land on an
// empty (height-0) element and do nothing — we re-apply across early animation frames until the
// content is tall enough to honour the saved offset (or the user starts scrolling), then persist
// every subsequent scroll. `passive` listeners keep scrolling smooth.
export function rememberScroll(node, key) {
  let k = key
  let settled = false
  const want = scrolls.get(k) || 0

  // The user touching the wheel/track mid-restore wins immediately — never fight a real scroll.
  const giveUp = () => { settled = true }
  node.addEventListener('wheel', giveUp, { passive: true, once: true })
  node.addEventListener('touchstart', giveUp, { passive: true, once: true })

  let frames = 0
  const apply = () => {
    if (settled) return
    if (want <= 0) { settled = true; return }
    // Honour the saved offset once the content can actually scroll that far; give up after ~40
    // frames (content never grew that tall — e.g. fewer rows now) and clamp to what's available.
    if (node.scrollHeight - node.clientHeight >= want) { node.scrollTop = want; settled = true; return }
    if (++frames > 40) { node.scrollTop = Math.min(want, node.scrollHeight); settled = true; return }
    requestAnimationFrame(apply)
  }
  requestAnimationFrame(apply)

  // Only record once restore has settled, so the restore pass doesn't overwrite the saved value with
  // a transient 0 while the list is still empty.
  const onScroll = () => { if (settled) scrolls.set(k, node.scrollTop) }
  node.addEventListener('scroll', onScroll, { passive: true })

  return {
    update(next) { k = next },
    destroy() {
      node.removeEventListener('scroll', onScroll)
      node.removeEventListener('wheel', giveUp)
      node.removeEventListener('touchstart', giveUp)
    },
  }
}
