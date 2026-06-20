// Svelte action: two-finger pinch → `onpinch(scale)` where `scale` is the cumulative finger-distance
// ratio since the gesture began (1 = unchanged, >1 = spread/zoom-in, <1 = pinch/zoom-out). This is
// the Android driver for the shared font-scale store (src/lib/fontscale.svelte.js) — the desktop uses
// Cmd/Ctrl +/- and on-screen buttons; the phone pinches. Mirrors longpress.js in spirit.
//
//   <div use:pinch={{ onpinchstart: () => base = fontScale.term,
//                     onpinch: (s) => setTerm(Math.round(base * s)) }}>
//
// Suppresses the WebView's native page pinch-zoom (preventDefault on the 2-finger move) and STOPS the
// gesture propagating, so nested pinch zones (the terminal vs the app body) don't both react — the
// inner one (the terminal) wins.
export function pinch(node, params = {}) {
  let opts = { ...params }
  let startDist = 0

  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  function onStart(e) {
    if (e.touches.length === 2) {
      startDist = dist(e.touches)
      e.stopPropagation() // claim the gesture (an outer pinch zone must not also handle it)
      opts.onpinchstart?.()
    }
  }
  function onMove(e) {
    if (startDist > 0 && e.touches.length === 2) {
      e.preventDefault() // no native page zoom (needs the non-passive listener below)
      e.stopPropagation()
      opts.onpinch?.(dist(e.touches) / startDist)
    }
  }
  function onEnd(e) {
    if (startDist > 0 && e.touches.length < 2) { startDist = 0; opts.onpinchend?.() }
  }

  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchmove', onMove, { passive: false })
  node.addEventListener('touchend', onEnd, { passive: true })
  node.addEventListener('touchcancel', onEnd, { passive: true })

  return {
    update(p) { opts = { ...p } },
    destroy() {
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', onEnd)
    },
  }
}
