<script>
  // The mesh view: GET /v1/mesh → a card per machine with a reachability dot, freshness, thread
  // counts and a thread preview. State honesty: an offline machine renders visibly offline with
  // dimmed last-known data — never silently stale.
  import { api } from '../lib/seshClient.js'
  import { ago, headGlyph } from '../lib/format.js'
  import { poll } from '../lib/connection.svelte.js'
  import { cacheSet, cacheGet } from '../lib/snapshot.svelte.js'
  import { pushError, pushInfo } from '../lib/toasts.svelte.js'
  import { registerBack } from '../lib/back.js'
  import { rememberScroll } from '../lib/viewstate.svelte.js'
  import ConfirmDialog from './ConfirmDialog.svelte'

  // Seed from the offline cache (Android) so a cold offline start shows the last-known mesh.
  let machines = $state(cacheGet('mesh')?.data || [])
  let peers = $state([])
  let peersSupported = $state(true)   // false if the daemon predates /v1/peers (schema <22)
  let adding = $state(false)
  let removeTarget = $state(null)
  // New-peer form fields (machine + ssh required; api_addr+token make it http-reachable for chat).
  let f = $state({ machine: '', ssh: '', home: '', api_addr: '', api_token: '' })

  // Android "back": close the remove-confirm dialog or the add-peer form before leaving the screen.
  $effect(() => registerBack(() => {
    if (removeTarget) { removeTarget = null; return true }
    if (adding) { adding = false; return true }
    return false
  }))

  async function refresh() {
    // Background poll → connection store (one banner), not per-tick toasts; keep last mesh.
    try { machines = (await poll(api.mesh())).machines || []; cacheSet('mesh', machines) } catch {}
    try { peers = (await api.peers()).peers || []; peersSupported = true }
    catch (e) { if (/:\s*404/.test(String(e))) peersSupported = false }
  }
  $effect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) })

  const liveCount = (m) => (m.threads || []).filter((t) => t.head === 'headful').length

  async function addPeer() {
    if (!f.machine.trim() || !f.ssh.trim()) return
    const peer = { machine: f.machine.trim(), ssh: f.ssh.trim() }
    if (f.home.trim()) peer.home = f.home.trim()
    if (f.api_addr.trim()) peer.api_addr = f.api_addr.trim()
    if (f.api_token.trim()) peer.api_token = f.api_token.trim()
    try {
      await api.peerAdd(peer)
      adding = false; f = { machine: '', ssh: '', home: '', api_addr: '', api_token: '' }
      pushInfo('Peer added'); await refresh()
    } catch (e) { pushError(`peer add: ${e.message ?? e}`) }
  }
  async function doRemove() {
    const m = removeTarget; removeTarget = null
    try { await api.peerRemove(m); await refresh() } catch (e) { pushError(`peer remove: ${e.message ?? e}`) }
  }
</script>

<div class="machines">
  <div class="topbar">
    <span class="h">Machines</span>
    <div class="spacer"></div>
    {#if peersSupported && !adding}<button class="primary" onclick={() => (adding = true)}>+ Add peer</button>{/if}
  </div>

  <div class="peers">
    {#if !peersSupported}
      <div class="note">Peer management needs a daemon on schema ≥22 (additive <code>/v1/peers</code>). This daemon predates it — peers are managed via <code>sesh peer add/remove</code> until it's redeployed.</div>
    {:else}
      {#if adding}
        <div class="addpeer">
          <input bind:value={f.machine} placeholder="machine (name)" />
          <input bind:value={f.ssh} placeholder="ssh (user@host)" />
          <input bind:value={f.home} placeholder="home (~/.sesh, optional)" />
          <input bind:value={f.api_addr} placeholder="api_addr (host:port, optional)" />
          <input bind:value={f.api_token} placeholder="api_token (optional)" />
          <button class="primary" onclick={addPeer} disabled={!f.machine.trim() || !f.ssh.trim()}>Add</button>
          <button onclick={() => (adding = false)}>Cancel</button>
        </div>
      {/if}
      {#if peers.length}
        <div class="peerlist">
          {#each peers as p (p.machine)}
            <div class="peer">
              <span class="pm">{p.machine}</span>
              <span class="pssh">{p.ssh}</span>
              {#if p.api_addr}<span class="papi" title="reachable over its TCP API (chat-capable)">⌘ {p.api_addr}</span>{:else}<span class="pssh2">ssh-only</span>{/if}
              <div class="spacer"></div>
              <button class="danger" onclick={() => (removeTarget = p.machine)}>Remove</button>
            </div>
          {/each}
        </div>
      {:else if !adding}
        <div class="note">No peers configured. Add one to chat with threads on another machine.</div>
      {/if}
    {/if}
  </div>

  <div class="grid" use:rememberScroll={'machines.grid'}>
    {#each machines as m (m.machine)}
      <div class="card {m.reachable ? '' : 'offline'}">
        <div class="c-head">
          <span class="dot" class:on={m.reachable}></span>
          <span class="name">{m.machine}{m.self ? ' (this)' : ''}</span>
          <span class="fresh" class:bad={!m.reachable}>{m.reachable ? ago(m.synced_at_unix) : 'OFFLINE'}</span>
        </div>
        {#if !m.reachable && m.synced_at_unix}<div class="lastseen">last seen {ago(m.synced_at_unix)} — showing last-known</div>{/if}
        <div class="stats">
          <span><b>{(m.threads || []).length}</b> threads</span>
          <span><b>{liveCount(m)}</b> live</span>
        </div>
        <div class="threads">
          {#each (m.threads || []).slice(0, 8) as t (t.id)}
            <div class="t"><span class="tg">{headGlyph(t.head)}</span>{t.name || '(nameless)'} <span class="ta">{t.agent_kind}</span></div>
          {/each}
          {#if (m.threads || []).length > 8}<div class="more">+{m.threads.length - 8} more</div>{/if}
          {#if (m.threads || []).length === 0}<div class="more">no threads</div>{/if}
        </div>
      </div>
    {/each}
    {#if machines.length === 0}<div class="empty">no machines in the mesh</div>{/if}
  </div>

  {#if removeTarget}
    <ConfirmDialog title="Remove peer?" danger confirmLabel="Remove"
      message={`"${removeTarget}" will be removed from this machine's peer registry (the remote daemon is untouched).`}
      onconfirm={doRemove} oncancel={() => (removeTarget = null)} />
  {/if}
</div>

<style>
  .machines { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .topbar { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #1f2030; background: #0e0f17; }
  .topbar .h { font-size: 16px; font-weight: 600; }
  .topbar .spacer { flex: 1; }
  .topbar .primary { background: #7aa2f7; color: #11121a; border: 0; border-radius: 6px; padding: 5px 12px; font-weight: 600; font-size: 12px; cursor: pointer; }
  .peers { padding: 12px 16px; border-bottom: 1px solid #1f2030; background: #0b0c12; display: flex; flex-direction: column; gap: 8px; }
  .peers .note { font-size: 12px; color: #565f89; } .peers .note code { color: #9aa5ce; }
  .addpeer { display: flex; flex-wrap: wrap; gap: 8px; }
  .addpeer input { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px; padding: 6px 9px; font-size: 12px; flex: 1; min-width: 130px; }
  .addpeer button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
  .addpeer .primary { background: #7aa2f7; color: #11121a; border: 0; font-weight: 600; }
  .peerlist { display: flex; flex-direction: column; gap: 5px; }
  .peer { display: flex; align-items: center; gap: 10px; background: #16161e; border: 1px solid #232433; border-radius: 7px; padding: 7px 11px; font-size: 12px; }
  .peer .pm { font-weight: 600; color: #c0caf5; }
  .peer .pssh { color: #9aa5ce; } .peer .pssh2 { color: #565f89; font-size: 11px; }
  .peer .papi { color: #7dcfff; font-size: 11px; }
  .peer .spacer { flex: 1; }
  .peer .danger { background: #1a1b26; color: #ffb4c0; border: 1px solid #5a2030; border-radius: 6px; padding: 4px 11px; cursor: pointer; font-size: 12px; }
  .grid { flex: 1; overflow: auto; padding: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; align-content: start; }
  .card { background: #0e0f17; border: 1px solid #1f2030; border-radius: 11px; padding: 14px; }
  .card.offline { opacity: 0.6; border-color: #3a1c28; }
  .c-head { display: flex; align-items: center; gap: 8px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #565f89; }
  .dot.on { background: #9ece6a; box-shadow: 0 0 6px #9ece6a88; }
  .name { font-weight: 600; font-size: 14px; flex: 1; }
  .fresh { font-size: 11px; color: #565f89; }
  .fresh.bad { color: #f7768e; }
  .lastseen { font-size: 10px; color: #f7768e; margin-top: 5px; }
  .stats { display: flex; gap: 16px; margin: 10px 0; font-size: 12px; color: #9aa5ce; }
  .stats b { color: #c0caf5; }
  .threads { display: flex; flex-direction: column; gap: 4px; }
  .t { font-size: 12px; color: #9aa5ce; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tg { color: #565f89; margin-right: 5px; }
  .ta { color: #565f89; font-size: 10px; }
  .more { font-size: 11px; color: #565f89; }
  .empty { color: #565f89; padding: 20px; }
</style>
