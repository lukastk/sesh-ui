// Svelte action: fire `onlongpress` after a touch/pen press-and-hold — the mobile trigger for the
// same reusable <ContextMenu> desktop opens via right-click. The Android thread (separate branch)
// applies this to thread rows / ticket cards; the desktop uses `oncontextmenu` directly. The
// callback gets { x, y } (clientX/clientY) so it can place the menu where the press happened.
//
//   <div use:longpress={{ onlongpress: (e) => (menu = { x: e.x, y: e.y, items }) }}>
//
// Cancels on release before the hold elapses, or on a move beyond a small tolerance (so a scroll
// doesn't trigger it). Mouse pointers are ignored (desktop right-click owns the menu).
export function longpress(node, params = {}) {
  let opts = { duration: 500, moveTolerance: 10, ...params }
  let timer = null
  let startX = 0
  let startY = 0

  const clear = () => { if (timer) { clearTimeout(timer); timer = null } }

  function onDown(e) {
    if (e.pointerType === 'mouse') return
    startX = e.clientX
    startY = e.clientY
    clear()
    timer = setTimeout(() => {
      timer = null
      opts.onlongpress?.({ x: startX, y: startY, target: node, originalEvent: e })
    }, opts.duration)
  }
  function onMove(e) {
    if (timer && (Math.abs(e.clientX - startX) > opts.moveTolerance || Math.abs(e.clientY - startY) > opts.moveTolerance)) clear()
  }

  node.addEventListener('pointerdown', onDown)
  node.addEventListener('pointermove', onMove)
  node.addEventListener('pointerup', clear)
  node.addEventListener('pointercancel', clear)
  node.addEventListener('pointerleave', clear)

  return {
    update(p) { opts = { duration: 500, moveTolerance: 10, ...p } },
    destroy() {
      clear()
      node.removeEventListener('pointerdown', onDown)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerup', clear)
      node.removeEventListener('pointercancel', clear)
      node.removeEventListener('pointerleave', clear)
    },
  }
}
