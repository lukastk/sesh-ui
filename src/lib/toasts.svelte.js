// Persistent action-error toasts. A verb failure (stop/delete/reparent/…) must be LOUD and
// must NOT be wiped by the next poll tick (FEATURE_UI_MAP risk #4) — so it lives here, in
// shared reactive state outside any screen's live-poll model, and is dismissed explicitly.

export const toasts = $state([])
let seq = 0

// Push a loud error toast; returns its id. Accepts an Error or any value. DEDUPED: an identical
// message already on screen bumps its count instead of stacking a duplicate (a safety net so no
// caller can ever flood the stack — background poll failures route to the connection banner, not
// here, but verb retries shouldn't pile up either).
export function pushError(msg) {
  const text = String(msg?.message ?? msg)
  const existing = toasts.find((t) => t.kind === 'error' && t.text === text)
  if (existing) { existing.count += 1; return existing.id }
  const id = ++seq
  toasts.push({ id, kind: 'error', text, count: 1 })
  return id
}
// Push a transient success/info note (auto-dismisses).
export function pushInfo(text, ms = 2500) {
  const id = ++seq
  toasts.push({ id, kind: 'info', text })
  setTimeout(() => dismiss(id), ms)
  return id
}
export function dismiss(id) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}
