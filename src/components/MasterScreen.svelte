<script>
  // The "Master" mode: a terminal attached to a machine's master tmux cockpit (the daemon runs
  // ui_config.master_command, e.g. "mmt-start", in a pty over a WebSocket — schema ≥28).
  //
  // PER-MACHINE: a selector lets you open ANY mesh machine's master, routed to that machine's
  // daemon via __machine (exactly like the thread terminal's cross-machine path). The connected
  // machine uses the local transport (machine=undefined); peers are dialed (Electron main holds
  // the token). Before attaching we read that machine's ui_config to see if master_command is set —
  // the daemon refuses the WS upgrade with a 409 when it's unset, and a browser can't read that
  // status off a failed upgrade, so we pre-check and show a clear notice instead of a blank screen.
  import { sesh, api } from '../lib/seshClient.js'
  import { conn } from '../lib/connection.svelte.js'
  import { pushError } from '../lib/toasts.svelte.js'
  import MasterTerminal from './MasterTerminal.svelte'

  // Machines we can open a master on: the connected daemon's machine + every dial-able peer.
  let connected = $derived(conn.machine)
  let peers = $state([])           // dial-able peer machine names (Electron); [] in web/dev
  $effect(() => { sesh.peerInfo().then((i) => { peers = i.peers || [] }).catch(() => {}) })

  // De-duped, stable machine list (connected first). In web/dev peers is empty → just the connected.
  let machines = $derived.by(() => {
    const out = []
    if (connected) out.push(connected)
    for (const p of peers) if (p !== connected) out.push(p)
    return out
  })

  let selected = $state(null)      // chosen machine name; defaults to the connected one once known
  $effect(() => { if (!selected && connected) selected = connected })

  // The `machine` arg for the WS / ui-config: undefined for the connected machine (local transport),
  // the name for a peer (routed). Keeps the connected case off the cross-machine bridge.
  let target = $derived(selected && selected !== connected ? selected : undefined)

  // Pre-check master_command for the selected machine. `nonce` lets "Reconnect" re-run it + remount.
  let nonce = $state(0)
  let loading = $state(false)
  let masterCommand = $state(null)
  let cfgErr = $state(null)
  $effect(() => {
    const m = selected, t = target, _ = nonce   // re-run on machine change or explicit reconnect
    void _
    if (!m) return
    loading = true; masterCommand = null; cfgErr = null
    api.uiConfigGet(t)
      .then((r) => { masterCommand = r.ui_config?.master_command || ''; })
      .catch((e) => { cfgErr = String(e?.message ?? e) })
      .finally(() => { loading = false })
  })

  function reconnect() { nonce++ }
</script>

<div class="master">
  <header>
    <span class="ttl">Master cockpit</span>
    <label class="mpick">
      machine
      <select bind:value={selected} disabled={machines.length === 0}>
        {#each machines as m (m)}
          <option value={m}>{m}{m === connected ? ' (connected)' : ''}</option>
        {/each}
      </select>
    </label>
    {#if masterCommand}<span class="cmd" title="ui_config.master_command on {selected}">$ {masterCommand}</span>{/if}
    <span class="sp"></span>
    <button class="recon" onclick={reconnect} disabled={!selected || loading} title="reattach to the master tmux">↻ Reconnect</button>
  </header>

  <section class="surface">
    {#if !connected}
      <div class="notice"><div class="ne">🔌</div><div class="nt">Daemon unreachable.</div>
        <div class="nb">Connect to a daemon to open its master cockpit.</div></div>
    {:else if loading}
      <div class="notice"><div class="nt">Loading…</div></div>
    {:else if cfgErr}
      <div class="notice"><div class="ne">⚠</div><div class="nt">Couldn't read ui_config for <b>{selected}</b>.</div>
        <div class="nb"><code>{cfgErr}</code></div></div>
    {:else if !masterCommand}
      <div class="notice"><div class="ne">🛠️</div>
        <div class="nt">No <code>master_command</code> configured in ui_config.toml for <b>{selected}</b>.</div>
        <div class="nb">Set it in Settings (e.g. <code>mmt-start</code>) on that machine's daemon to attach its master tmux here.</div></div>
    {:else}
      {#key selected + ':' + nonce}<MasterTerminal machine={target} />{/key}
    {/if}
  </section>
</div>

<style>
  .master { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #1f2030;
    background: #0e0f17; flex-shrink: 0; flex-wrap: wrap; }
  .ttl { font-size: 15px; font-weight: 600; }
  .mpick { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #565f89;
    text-transform: uppercase; letter-spacing: 0.05em; }
  .mpick select { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px;
    padding: 4px 8px; font-size: 12px; text-transform: none; letter-spacing: normal; }
  .cmd { font-size: 11px; color: #7dcfff; font-family: ui-monospace, monospace; background: #142733;
    border: 1px solid #1e3a4a; border-radius: 5px; padding: 2px 7px; }
  .sp { flex: 1; }
  .recon { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px;
    padding: 5px 12px; font-size: 12px; cursor: pointer; }
  .recon:hover { background: #232433; }
  .recon:disabled { opacity: 0.5; cursor: default; }
  .surface { flex: 1; min-height: 0; }
  .notice { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; text-align: center; padding: 24px; max-width: 560px; margin: 0 auto; }
  .notice .ne { font-size: 34px; }
  .notice .nt { font-size: 16px; color: #c0caf5; }
  .notice .nt b, .notice .nb b { color: #7dcfff; }
  .notice .nb { font-size: 13px; color: #9aa5ce; line-height: 1.55; }
  .notice code { color: #7aa2f7; font-family: ui-monospace, monospace; }
</style>
