// Offline last-snapshot cache (Android). Background polls persist their latest payload here so a
// COLD START WITH NO CONNECTIVITY can render the last-known grid / mesh / tickets immediately —
// always behind the LOUD offline banner (honesty about state: cached data is never shown as if it
// were live; the App banner names its age). Writes (lifecycle verbs) still require connectivity and
// fail loudly via the toast store — only the read/poll surfaces are served from cache.
//
// Gated to the Android transport: a phone routinely loses its tailnet (sleep, no signal), so a
// last-known view is worth a lot there. The desktop/Electron app (a stable, always-on-LAN client,
// verified "ready for Lukas") keeps its existing start-empty-then-poll behavior unchanged.
import { sesh } from './seshClient.js'

const ON = sesh.transport === 'android'
const PREFIX = 'seshui.snap.'

// Persist a poll payload — call on every SUCCESSFUL background poll. No-op off Android.
export function cacheSet(key, data) {
  if (!ON) return
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Math.floor(Date.now() / 1000), data }))
  } catch {}
}

// Read a cached payload → { at, data } (unix-seconds `at`, for format.ago()) or null.
export function cacheGet(key) {
  if (!ON) return null
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
