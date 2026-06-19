// Persistent action-error toasts. A verb failure (stop/delete/reparent/…) must be LOUD and
// must NOT be wiped by the next poll tick (FEATURE_UI_MAP risk #4) — so it lives here, in
// shared reactive state outside any screen's live-poll model, and is dismissed explicitly.

export const toasts = $state([])
let seq = 0

// Push a loud error toast; returns its id. Accepts an Error or any value.
export function pushError(msg) {
  const id = ++seq
  toasts.push({ id, kind: 'error', text: String(msg?.message ?? msg) })
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
