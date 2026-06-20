<script>
  // The app shell: top-nav router (Threads / Tickets / Machines), a live daemon-status
  // header (the connection indicator), and the global action-error toast stack. Everything
  // reaches the daemon through seshClient — this file never fetches directly.
  import { sesh, api } from './lib/seshClient.js'
  import { toasts, dismiss } from './lib/toasts.svelte.js'
  import { conn, noteOk, noteFail } from './lib/connection.svelte.js'
  import { cacheGet } from './lib/snapshot.svelte.js'
  import { startTranscriptPrefetch, stopTranscriptPrefetch } from './lib/transcriptCache.js'
  import { fontScale, bumpScale, resetScale, setScale } from './lib/fontscale.svelte.js'
  import { pinch } from './lib/pinch.js'
  import { registerBack, runBack } from './lib/back.js'
  import { App as CapApp } from '@capacitor/app'
  import { ago } from './lib/format.js'
  import ThreadsScreen from './components/ThreadsScreen.svelte'
  import TicketsBoard from './components/TicketsBoard.svelte'
  import MachinesScreen from './components/MachinesScreen.svelte'
  import AutomationScreen from './components/AutomationScreen.svelte'
  import SettingsModal from './components/SettingsModal.svelte'

  const tabs = [['threads', 'Threads'], ['tickets', 'Tickets'], ['machines', 'Machines'], ['automation', 'Automation']]
  let screen = $state('threads')
  let showSettings = $state(false)

  let daemon = $state(null)
  let autoPrompted = $state(false)

  async function pollStatus() {
    try {
      daemon = await api.status(); noteOk(); conn.machine = daemon.machine
    } catch (e) {
      daemon = null; noteFail(e)
      // First-run guidance: if we can't reach a daemon AND the user has never chosen an
      // endpoint (we're only guessing the default local socket), open Settings once so they
      // can point the app at their daemon. Only in a packaged transport (web/dev is fixed).
      if (!autoPrompted && sesh.transport !== 'web') {
        autoPrompted = true
        try { const c = await sesh.getConfig(); if (c.editable && !c.configured) showSettings = true } catch {}
      }
    }
  }
  $effect(() => { pollStatus(); const t = setInterval(pollStatus, 4000); return () => clearInterval(t) })

  // Background transcript prefetch: read the interval from the daemon's ui_config (schema ≥27,
  // default 10s, 0=off) once on load and start the loop so opening any thread's transcript is
  // instant from cache. An older daemon (no field) → undefined ?? 10 = the default; the transcript
  // endpoint itself predates schema 27, so prefetch still works there.
  $effect(() => {
    let cancelled = false
    api.uiConfigGet()
      .then((r) => { if (!cancelled) startTranscriptPrefetch(r.ui_config?.transcript_prefetch_secs ?? 10) })
      .catch(() => {})   // daemon unreachable on first load — pollStatus drives the retry/banner
    return () => { cancelled = true; stopTranscriptPrefetch() }
  })

  // Apply the app-wide UI scale (reactive): a CSS var consumed by `.app { zoom: var(--font-scale) }`.
  $effect(() => { document.documentElement.style.setProperty('--font-scale', String(fontScale.scale)) })
  // Desktop shortcuts: Cmd/Ctrl +/- to scale, Cmd/Ctrl 0 to reset. (Android pinch drives the same store.)
  function onKey(e) {
    if (!(e.metaKey || e.ctrlKey)) return
    if (e.key === '=' || e.key === '+') { e.preventDefault(); bumpScale(0.1) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); bumpScale(-0.1) }
    else if (e.key === '0') { e.preventDefault(); resetScale() }
  }

  // Android pinch-to-zoom drives the SAME app-wide scale store (the terminal has its own pinch →
  // terminal font size, which claims the gesture so this doesn't also fire over it).
  let pinchBaseScale = 1
  function onPinchStart() { pinchBaseScale = fontScale.scale }
  function onPinchMove(scale) { setScale(pinchBaseScale * scale) }

  // Android system BACK (the right/left-edge swipe gesture AND the back button both fire this):
  // run the in-app back stack (close an overlay / leave a thread detail for the list); only exit the
  // app when there's nothing left to go back to — the standard Android "back at root" behavior.
  $effect(() => {
    if (sesh.transport !== 'android') return
    let handle
    CapApp.addListener('backButton', () => { if (!runBack()) CapApp.exitApp() }).then((h) => (handle = h))
    return () => handle?.remove()
  })
  // Settings is an app-level overlay; register a back handler while it's open so back closes it first.
  $effect(() => { if (showSettings) return registerBack(() => { showSettings = false; return true }) })
</script>

<svelte:window onkeydown={onKey} />

<div class="app">
  <nav>
    <div class="brand">sesh<span>ui</span></div>
    <div class="tabs">
      {#each tabs as [id, label]}
        <button class:on={screen === id} onclick={() => (screen = id)}>{label}</button>
      {/each}
    </div>
    <div class="spacer"></div>
    <div class="conn" title="transport: {sesh.transport}">
      {#if daemon}
        <span class="dot ok"></span>
        <span class="txt">{daemon.machine} · schema {daemon.schema_version} · pid {daemon.pid}</span>
      {:else}
        <span class="dot bad"></span>
        <span class="txt err">daemon unreachable</span>
      {/if}
    </div>
    <div class="fontctl" title="UI size (Cmd/Ctrl +/−, Cmd/Ctrl 0 to reset)">
      <button onclick={() => bumpScale(-0.1)} aria-label="smaller UI">A−</button>
      <button class="reset" onclick={resetScale} title="reset to 100%">{Math.round(fontScale.scale * 100)}%</button>
      <button onclick={() => bumpScale(0.1)} aria-label="larger UI">A+</button>
    </div>
    <button class="gear" onclick={() => (showSettings = true)} title="Connection settings" aria-label="settings">⚙</button>
  </nav>

  <div class="body" use:pinch={{ onpinchstart: onPinchStart, onpinch: onPinchMove }}>
    {#if screen === 'threads'}<ThreadsScreen />
    {:else if screen === 'tickets'}<TicketsBoard />
    {:else if screen === 'machines'}<MachinesScreen />
    {:else if screen === 'automation'}<AutomationScreen />{/if}
  </div>

  <!-- ONE connection banner for an unreachable daemon — driven by the shared connection store
       that every background poll reports to (never per-poll toasts; that flooded the stack). -->
  {#if !conn.online}
    <div class="connbanner">
      <div class="cb-head">
        <span>Cannot reach the sesh daemon.</span>
        {#if sesh.transport !== 'web'}
          <button class="cb-cfg" onclick={() => (showSettings = true)}>Configure connection…</button>
        {/if}
      </div>
      {#if conn.error}<code>{conn.error}</code>{/if}
      {#if sesh.transport === 'android'}
        {@const cached = cacheGet('grid')}
        {#if cached}
          <small class="stale">⚠ Showing last-known cached data ({ago(cached.at)}). Actions need connectivity and will fail until the hub is reachable.</small>
        {/if}
      {/if}
      {#if sesh.transport === 'web'}
        <small>Start a dev daemon (PLAN.md → "Running a dev daemon") and check vite.config.js endpoint/token.</small>
      {:else}
        <small>Set the endpoint (local socket / remote host:port) and token in Connection settings.</small>
      {/if}
    </div>
  {/if}

  {#if showSettings}<SettingsModal onclose={() => (showSettings = false)} />{/if}

  <!-- Global loud action errors — persistent, dismissed explicitly, above the poll model. -->
  {#if toasts.length}
    <div class="toasts">
      {#each toasts as t (t.id)}
        <div class="toast {t.kind}">
          <span class="t-text">{t.text}{#if t.count > 1}<span class="t-count"> ×{t.count}</span>{/if}</span>
          <button class="t-x" onclick={() => dismiss(t.id)} aria-label="dismiss">×</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  :global(:root) { color-scheme: dark; }
  :global(body) { margin: 0; background: #11121a; color: #c0caf5;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  /* Only the app's internal regions scroll (.list, the chat log, …); the page itself never does.
     Without this a layout wider/taller than the viewport let the whole page scroll on both axes
     (very visible on a phone). */
  :global(html, body) { height: 100%; overflow: hidden; overscroll-behavior: none; }
  :global(*) { box-sizing: border-box; }

  /* App-wide UI scale via `zoom`; the size is divided by the scale so after zoom it still fills the
     viewport exactly (no overflow/scrollbars). --font-scale is set on :root from the fontScale store. */
  .app { display: flex; flex-direction: column; zoom: var(--font-scale, 1);
    height: calc(100dvh / var(--font-scale, 1)); width: calc(100vw / var(--font-scale, 1)); overflow: hidden; }
  nav { display: flex; align-items: center; gap: 18px; padding: 0 16px; height: 48px;
    background: #0b0c12; border-bottom: 1px solid #1f2030; flex-shrink: 0; }
  .brand { font-size: 17px; font-weight: 800; letter-spacing: -0.02em; }
  .brand span { color: #7aa2f7; }
  .tabs { display: flex; gap: 4px; }
  .tabs button { background: none; border: 0; color: #9aa5ce; padding: 6px 14px; font-size: 13px;
    cursor: pointer; border-radius: 7px; }
  .tabs button:hover { background: #16161e; }
  .tabs button.on { background: #1c1d2b; color: #fff; font-weight: 600; }
  .spacer { flex: 1; }
  .conn { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #7aa2f7; }
  .conn .txt.err { color: #f7768e; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .dot.ok { background: #9ece6a; box-shadow: 0 0 6px #9ece6a88; }
  .dot.bad { background: #f7768e; }
  .fontctl { display: flex; align-items: center; gap: 1px; }
  .fontctl button { background: none; border: 0; color: #565f89; cursor: pointer; font-size: 12px; padding: 3px 6px; border-radius: 5px; }
  .fontctl button:hover { background: #16161e; color: #9aa5ce; }
  .fontctl .reset { font-size: 10px; min-width: 34px; }
  .gear { background: none; border: 0; color: #565f89; cursor: pointer; font-size: 16px; padding: 2px 4px; border-radius: 6px; }
  .gear:hover { background: #16161e; color: #9aa5ce; }

  .body { flex: 1; min-height: 0; }

  .connbanner { position: fixed; bottom: 14px; left: 14px; max-width: 460px; padding: 12px 14px;
    background: #3a1c28; color: #ffb4c0; border: 1px solid #5a2030; border-radius: 9px;
    font-size: 13px; display: flex; flex-direction: column; gap: 5px; z-index: 60; }
  .connbanner code { font-size: 11px; color: #ff9eb1; word-break: break-all; }
  .connbanner small { color: #d98a9a; }
  .connbanner .stale { color: #ffd27a; font-weight: 600; }
  .cb-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .cb-cfg { background: #ffb4c0; color: #3a1c28; border: 0; border-radius: 6px; padding: 4px 10px;
    font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .cb-cfg:hover { background: #ffc9d2; }

  .toasts { position: fixed; top: 58px; right: 14px; display: flex; flex-direction: column; gap: 8px;
    z-index: 70; max-width: 420px; }
  .toast { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 9px;
    font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
  .toast.error { background: #3a1c28; color: #ffb4c0; border: 1px solid #5a2030; }
  .toast.info { background: #1b2b1c; color: #c5f0bb; border: 1px solid #2f5a30; }
  .t-text { flex: 1; white-space: pre-wrap; word-break: break-word; }
  .t-count { opacity: 0.7; font-weight: 700; }
  .t-x { background: none; border: 0; color: inherit; cursor: pointer; font-size: 16px; line-height: 1;
    opacity: 0.7; padding: 0; }
  .t-x:hover { opacity: 1; }

  /* Phone width: tighten the nav and let it scroll horizontally if the tabs don't fit, drop the
     verbose daemon text (the dot still shows reachability; Machines shows the detail), and let the
     banner/toasts span the width. */
  @media (max-width: 720px) {
    nav { gap: 8px; padding: 0 10px; overflow-x: auto; }
    .tabs button { padding: 6px 10px; }
    .conn .txt { display: none; }
    .connbanner { left: 8px; right: 8px; max-width: none; }
    .toasts { left: 8px; right: 8px; max-width: none; }
  }
</style>
