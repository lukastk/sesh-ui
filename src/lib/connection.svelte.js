// Shared daemon-reachability state. BACKGROUND POLLS report here instead of spawning toasts —
// so an unreachable daemon shows ONE persistent banner (in App.svelte), never a flood of stacked
// toasts (one per failed poll tick). Toasts stay reserved for discrete, user-initiated verb
// failures (stop/delete/…), which don't repeat on a timer.
//
// `online` flips false on the first failed poll and true again on the first success, so
// daemon-down → reconnect is graceful with no manual dismissal.

export const conn = $state({ online: true, error: null })

// A poll succeeded — clear any outage.
export function noteOk() {
  if (!conn.online || conn.error) { conn.online = true; conn.error = null }
}
// A poll failed — record the outage (the latest error message wins). No toast.
export function noteFail(e) {
  const text = String(e?.message ?? e)
  conn.online = false
  conn.error = text
}

// Wrap a poll: run it, report ok/fail to the shared state, and re-throw so the caller can still
// decide what to do with the data. Background pollers use this and simply swallow the throw.
export async function poll(promise) {
  try { const v = await promise; noteOk(); return v }
  catch (e) { noteFail(e); throw e }
}
