<script>
  // The app shell: top-nav router (Threads / Tickets / Machines), a live daemon-status
  // header (the connection indicator), and the global action-error toast stack. Everything
  // reaches the daemon through seshClient — this file never fetches directly.
  import { sesh, api } from './lib/seshClient.js'
  import { toasts, dismiss } from './lib/toasts.svelte.js'
  import { conn, noteOk, noteFail } from './lib/connection.svelte.js'
  import ThreadsScreen from './components/ThreadsScreen.svelte'
  import TicketsBoard from './components/TicketsBoard.svelte'
  import MachinesScreen from './components/MachinesScreen.svelte'
  import SettingsModal from './components/SettingsModal.svelte'

  const tabs = [['threads', 'Threads'], ['tickets', 'Tickets'], ['machines', 'Machines']]
  let screen = $state('threads')
  let showSettings = $state(false)

  let daemon = $state(null)
  let autoPrompted = $state(false)

  async function pollStatus() {
    try {
      daemon = await api.status(); noteOk()
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
</script>

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
    <button class="gear" onclick={() => (showSettings = true)} title="Connection settings" aria-label="settings">⚙</button>
  </nav>

  <div class="body">
    {#if screen === 'threads'}<ThreadsScreen />
    {:else if screen === 'tickets'}<TicketsBoard />
    {:else if screen === 'machines'}<MachinesScreen />{/if}
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
  :global(*) { box-sizing: border-box; }

  .app { display: flex; flex-direction: column; height: 100vh; }
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
  .gear { background: none; border: 0; color: #565f89; cursor: pointer; font-size: 16px; padding: 2px 4px; border-radius: 6px; }
  .gear:hover { background: #16161e; color: #9aa5ce; }

  .body { flex: 1; min-height: 0; }

  .connbanner { position: fixed; bottom: 14px; left: 14px; max-width: 460px; padding: 12px 14px;
    background: #3a1c28; color: #ffb4c0; border: 1px solid #5a2030; border-radius: 9px;
    font-size: 13px; display: flex; flex-direction: column; gap: 5px; z-index: 60; }
  .connbanner code { font-size: 11px; color: #ff9eb1; word-break: break-all; }
  .connbanner small { color: #d98a9a; }
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
</style>
