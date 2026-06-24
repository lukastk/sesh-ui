// In-memory transcript cache + the background prefetch loop. The goal: opening a thread's
// Transcript/RPC view is INSTANT — we render the cached parsed messages immediately, then the view
// does its own fresh fetch to update. The loop silently fetches every non-archived thread's
// transcript on a configurable interval (ui_config.transcript_prefetch_secs from the daemon).
//
// This is purely a first-paint optimization: the live views remain the source of truth (they always
// re-fetch on open and keep polling). The cache only ever fills in the gap before that fetch lands.
import { api } from './seshClient.js'
import { parseTranscript } from './transcript.js'

// id → { msgs, at, sig }. `sig` is a cheap activity fingerprint used to skip re-fetching an idle,
// unchanged thread (load reduction). `msgs` is the already-parsed bubble list for that thread.
const cache = new Map()

// Parsed transcript messages for a thread, or null if nothing has been prefetched/loaded yet.
export function getCachedTranscript(id) {
  return cache.get(id)?.msgs ?? null
}

// Record a freshly-loaded transcript. The live views call this after every successful fetch too, so
// navigating away from a thread and back is instant even before the next prefetch cycle runs.
export function putCachedTranscript(id, msgs) {
  const prev = cache.get(id)
  cache.set(id, { msgs, at: Date.now(), sig: prev?.sig })
}

let timer = null
let running = false

// A row's activity fingerprint. An idle thread whose head/busy hasn't changed since the last fetch
// can't have a new turn (a turn flips busy → 'busy'), so we skip re-fetching it. Busy threads are
// always re-fetched (their transcript is actively growing).
const sigOf = (r) => `${r.head}|${r.busy}`

// One prefetch pass: pull the whole-mesh grid, then fetch+cache each non-archived thread's
// transcript on its OWN machine. Guarded so overlapping cycles (a slow pass + the next tick) never
// run concurrently. All errors are swallowed — this is best-effort background work; the App's
// connection banner already surfaces an unreachable daemon, and each view re-fetches loudly on open.
// How many transcripts to prefetch concurrently. The cache used to warm SERIALLY (one await per
// thread), so with dozens of active threads the first pass took several seconds — long enough that
// clicking a not-yet-warmed thread still hit the "Loading…" state. A bounded worker pool warms the
// whole mesh in ~ceil(N / PREFETCH_CONCURRENCY) round-trips instead of N, while staying gentle on
// the (often shared) daemon.
const PREFETCH_CONCURRENCY = 6

async function fetchInto(r) {
  const sig = sigOf(r)
  try {
    const t = await api.transcript(r.id, 300, r.machine)
    cache.set(r.id, { msgs: parseTranscript(t.lines || [], r.agent_kind), at: Date.now(), sig })
  } catch (e) {
    // A never-run thread legitimately has no transcript — cache an empty list so its view shows the
    // real empty state instantly. Any other error: leave the prior cache and retry next cycle.
    if (/no transcript/i.test(String(e))) cache.set(r.id, { msgs: [], at: Date.now(), sig })
  }
}

async function cycle() {
  if (running) return
  running = true
  try {
    let rows
    try { rows = (await api.grid({ allMachines: true })).rows || [] }
    catch { return }   // daemon unreachable — try again next tick
    // The threads that actually need a (re)fetch this pass: non-archived, and either busy (transcript
    // is growing) or changed since we last cached them (idle & unchanged → skip to save load).
    const todo = rows.filter((r) => {
      if (r.archived) return false
      const prev = cache.get(r.id)
      return !(prev && prev.sig === sigOf(r) && r.busy !== 'busy')
    })
    // Drain `todo` through a fixed pool of workers — bounded concurrency, no overlap with the next
    // tick (the `running` guard still serializes whole cycles).
    let next = 0
    const worker = async () => { while (next < todo.length) await fetchInto(todo[next++]) }
    await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, todo.length) }, worker))
  } finally {
    running = false
  }
}

// Start (or restart) the background prefetch loop at `secs` seconds. 0 / falsy disables it (and
// stops any running loop). Re-callable: SettingsModal calls this when the interval changes.
export function startTranscriptPrefetch(secs) {
  stopTranscriptPrefetch()
  if (!secs || secs <= 0) return
  cycle()                                   // prime immediately so the first thread opened is fast
  timer = setInterval(cycle, secs * 1000)
}

export function stopTranscriptPrefetch() {
  if (timer) { clearInterval(timer); timer = null }
}
