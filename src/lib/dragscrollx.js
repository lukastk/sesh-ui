// Svelte action: drag a touch HORIZONTALLY to scroll the node's overflow-x (Android). The Tickets
// board is a horizontal scroller whose columns are vertical scrollers; on touch, a swipe that began
// over a column's vertical scroller (or its empty space) was swallowed by that scroller and never
// reached the board, so only swipes that began on a non-scrolling card scrolled it. This drives
// node.scrollLeft directly from a one-finger drag, so a horizontal swipe scrolls the board from
// ANYWHERE on it — while a vertical-dominant swipe is left to the native column scroll (axis-locked
// on the first move; we only preventDefault once we've claimed the horizontal axis).
//
// No-op for non-touch input (desktop uses the trackpad/wheel on the overflow-x directly).
export function dragscrollx(node) {
  let startX = 0
  let startY = 0
  let startLeft = 0
  let axis = null // null until decided, then 'x' (we scroll) or 'y' (native column scroll)
  const THRESH = 6

  function onStart(e) {
    if (e.touches.length !== 1) return
    startX = e.touches[0].clientX
    startY = e.touches[0].clientY
    startLeft = node.scrollLeft
    axis = null
  }
  function onMove(e) {
    if (e.touches.length !== 1) return
    const dx = e.touches[0].clientX - startX
    const dy = e.touches[0].clientY - startY
    if (axis === null) {
      if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (axis === 'x') {
      e.preventDefault() // claim the horizontal gesture (stops native column scroll / page)
      node.scrollLeft = startLeft - dx
    }
  }

  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchmove', onMove, { passive: false }) // non-passive: we preventDefault on x
  return {
    destroy() {
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
    },
  }
}
