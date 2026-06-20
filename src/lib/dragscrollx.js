// Svelte action: touch drag-to-scroll a horizontal overflow (the Android Tickets kanban). xterm-style
// native scroll can't be used here — a horizontal swipe that starts over a column's vertical scroller
// (.cards, overflow-y) is swallowed and never reaches the board — so we drive node.scrollLeft from a
// one-finger drag. The naive version (just track the finger) stopped DEAD on release, which felt
// awkward; this adds momentum/inertia + a gentle snap to the nearest column, so it feels like a
// native fling.
//
// Axis-locked on the first move: a horizontal-dominant drag scrolls the board (preventDefault, so it
// doesn't fight the column's vertical scroll); a vertical-dominant drag is left entirely to the native
// column scroll. A tap (no move) and a press-and-hold (longpress menu) are untouched — we only act
// once the finger has clearly moved horizontally, and the drag's preventDefault suppresses the would-be
// click so a fling never opens a card. No-op for non-touch input (desktop uses trackpad/wheel).
export function dragscrollx(node, opts = {}) {
  const doSnap = opts.snap !== false
  const THRESH = 6 // px before we commit to an axis

  let startX = 0, startY = 0, startLeft = 0, axis = null
  let lastX = 0, lastT = 0, vx = 0 // finger velocity, px/ms
  let raf = null

  const maxScroll = () => node.scrollWidth - node.clientWidth
  const clamp = (x) => Math.max(0, Math.min(maxScroll(), x))
  const stopAnim = () => { if (raf) { cancelAnimationFrame(raf); raf = null } }

  function onStart(e) {
    if (e.touches.length !== 1) return
    stopAnim() // grab a fling in progress
    const t = e.touches[0]
    startX = lastX = t.clientX
    startY = t.clientY
    startLeft = node.scrollLeft
    lastT = performance.now()
    vx = 0
    axis = null
  }

  function onMove(e) {
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (axis === null) {
      if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (axis !== 'x') return
    e.preventDefault() // claim the horizontal gesture
    node.scrollLeft = clamp(startLeft - dx)
    const now = performance.now()
    const dt = now - lastT
    if (dt > 0) { vx = (t.clientX - lastX) / dt; lastX = t.clientX; lastT = now }
  }

  function onEnd() {
    if (axis !== 'x') { axis = null; return }
    axis = null
    // Scroll velocity is opposite the finger; convert px/ms → px/frame and cap it.
    let v = Math.max(-90, Math.min(90, -vx * 16))
    const friction = 0.94
    const fling = () => {
      v *= friction
      const max = maxScroll()
      const next = node.scrollLeft + v
      if (next <= 0 || next >= max) { node.scrollLeft = clamp(next); raf = null; return snap() }
      node.scrollLeft = next
      if (Math.abs(v) < 0.6) { raf = null; return snap() }
      raf = requestAnimationFrame(fling)
    }
    if (Math.abs(v) > 0.6) raf = requestAnimationFrame(fling)
    else snap()
  }

  // Gently settle to the nearest column's left edge once the fling has spent itself.
  function snap() {
    if (!doSnap) return
    const cols = [...node.children]
    if (cols.length < 2) return
    const base = cols[0].offsetLeft
    const cur = node.scrollLeft
    let target = clamp(cols[0].offsetLeft - base)
    for (const c of cols) {
      const p = clamp(c.offsetLeft - base)
      if (Math.abs(p - cur) < Math.abs(target - cur)) target = p
    }
    if (Math.abs(target - cur) < 1) return
    const dist = target - cur
    const dur = 220
    const t0 = performance.now()
    const ease = (p) => 1 - Math.pow(1 - p, 3) // easeOutCubic
    const anim = () => {
      const p = Math.min(1, (performance.now() - t0) / dur)
      node.scrollLeft = cur + dist * ease(p)
      raf = p < 1 ? requestAnimationFrame(anim) : null
    }
    raf = requestAnimationFrame(anim)
  }

  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchmove', onMove, { passive: false }) // non-passive: preventDefault on x
  node.addEventListener('touchend', onEnd, { passive: true })
  node.addEventListener('touchcancel', onEnd, { passive: true })
  return {
    destroy() {
      stopAnim()
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', onEnd)
    },
  }
}
