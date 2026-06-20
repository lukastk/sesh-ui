// A tiny LIFO registry of "back" handlers. On Android the system BACK action — both the gesture-nav
// edge swipe (swipe inward from the right/left edge) AND the back button — fires @capacitor/app's
// `backButton` event (wired in App.svelte); we run the most-recently-registered handler that CLAIMS
// the back, and if none do, the app exits (the normal Android "back at the root" behavior).
//
// Components register a handler while they have something to go back FROM — an open overlay, or a
// selected thread (detail → list) — and the handler returns true once it has consumed the back. A
// screen registers ONE handler that checks its overlays in priority order (topmost first), so back
// peels them off one at a time. Off Android nothing calls runBack(), so registrations are harmless.
const stack = []

// Register a back handler; returns an unregister function (use as a Svelte $effect cleanup).
export function registerBack(fn) {
  stack.push(fn)
  return () => {
    const i = stack.indexOf(fn)
    if (i >= 0) stack.splice(i, 1)
  }
}

// Run the topmost handler that claims the back. Returns true if one handled it.
export function runBack() {
  for (let i = stack.length - 1; i >= 0; i--) {
    try { if (stack[i]()) return true } catch {}
  }
  return false
}
