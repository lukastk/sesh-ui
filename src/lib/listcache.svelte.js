// listcache — a WARM in-memory cache of the two list payloads (the threads grid + the tickets
// list), kept fresh by a small background prefetch loop. Switching to the Threads or Tickets tab
// then paints the last-known list INSTANTLY instead of an empty pane that waits for the first poll
// (the "loading times" the user reported). All transports (not just Android): the Android offline
// localStorage snapshot in snapshot.svelte.js is a SEPARATE thing — it survives a process restart to
// seed a cold offline start; this one is in-memory only and survives screen mount/unmount within a
// session.
//
// Honesty about state: each screen still polls live once mounted; this only removes the first-paint
// gap. `*At` timestamps let a screen tell a genuine cold start (never loaded → show a skeleton) from
// a warm one (paint cache, refresh underneath).
import { api } from './seshClient.js'
import { poll } from './connection.svelte.js'

export const warm = $state({
  grid: null, gridAt: 0,                       // rows[] from /threads/grid (default params)
  tickets: null, ticketsUnreachable: [], ticketsAt: 0,  // tickets[] from /tickets/list-all
})

// Screens call these on every successful poll so the cache tracks live data while a tab is open.
export function setGrid(rows) { warm.grid = rows; warm.gridAt = Date.now() }
export function setTickets(tickets, unreachable) {
  warm.tickets = tickets; warm.ticketsUnreachable = unreachable || []; warm.ticketsAt = Date.now()
}

// Background prefetch: keep both lists warm even when NEITHER screen is mounted, so the very first
// tab open is instant. Skips a fetch when a mounted screen already refreshed it recently (the guard),
// so an open tab's own poll isn't doubled.
let timer = null
const FRESH_MS = 4000
async function prefetch() {
  if (Date.now() - warm.gridAt > FRESH_MS) {
    // Default Threads view: archived off, all machines on (mirrors ThreadsScreen's defaults).
    try { setGrid((await poll(api.grid({ allMachines: true }))).rows || []) } catch {}
  }
  if (Date.now() - warm.ticketsAt > FRESH_MS) {
    try { const r = await poll(api.ticketsAll()); setTickets(r.tickets || [], r.unreachable) } catch {}
  }
}
export function startListPrefetch(secs = 8) {
  stopListPrefetch()
  prefetch()
  if (secs > 0) timer = setInterval(prefetch, secs * 1000)
}
export function stopListPrefetch() { if (timer) { clearInterval(timer); timer = null } }
