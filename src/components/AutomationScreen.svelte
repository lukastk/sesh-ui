<script>
  // Automation center: the daemon's HOOKS (event → command, with mute + synchronous test) and
  // agent-to-agent SUBSCRIPTIONS (subscriber thread ← subscribee thread, delivered on the
  // subscribee's turn completion). Both are thin views over the daemon endpoints — list + the
  // few mutating verbs; no client-side re-derivation.
  import { api } from '../lib/seshClient.js'
  import { shortId } from '../lib/format.js'
  import { pushError, pushInfo } from '../lib/toasts.svelte.js'
  import { poll } from '../lib/connection.svelte.js'
  import { rememberScroll } from '../lib/viewstate.svelte.js'

  let hooks = $state([])
  let subs = $state([])
  let rows = $state([])              // threads, for name resolution + the subscribe pickers
  let testOut = $state(null)         // { name, ok, output, error } from a hook test
  let adding = $state(false)
  let newSubr = $state('')           // subscriber thread id
  let newSube = $state('')           // subscribee thread id
  let allowCycle = $state(false)

  async function refresh() {
    try {
      const [h, s, g] = await Promise.all([poll(api.hooks()), api.subscriptions(), api.grid()])
      hooks = h.hooks || []
      subs = s.subscriptions || []
      rows = g.rows || []
    } catch {}
  }
  $effect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t) })

  const nameOf = (id) => { const r = rows.find((x) => x.id === id); return r ? (r.name || shortId(id)) : shortId(id) }

  async function toggleMute(h) {
    try { await api.hookMute(h.name, !h.muted); await refresh() }
    catch (e) { pushError(`hook ${h.muted ? 'enable' : 'disable'}: ${e.message ?? e}`) }
  }
  async function test(h) {
    testOut = { name: h.name, running: true }
    try { const r = await api.hookTest(h.name); testOut = { name: h.name, ok: r.ok, output: r.output, error: r.error } }
    catch (e) { testOut = { name: h.name, ok: false, error: String(e.message ?? e) } }
  }
  async function addSub() {
    if (!newSubr || !newSube) return
    try { await api.subscribe(newSubr, newSube, allowCycle); adding = false; newSubr = newSube = ''; allowCycle = false; await refresh() }
    catch (e) { pushError(`subscribe: ${e.message ?? e}`) }
  }
  async function removeSub(s) {
    try { await api.unsubscribe(s.subscriber, s.subscribee); await refresh() }
    catch (e) { pushError(`unsubscribe: ${e.message ?? e}`) }
  }
</script>

<div class="wrap" use:rememberScroll={'automation.wrap'}>
  <section class="panel">
    <div class="phead"><span class="h">Hooks</span><span class="sub">event → command, with mute &amp; synchronous test</span></div>
    {#if hooks.length === 0}
      <div class="empty">No hooks configured (see sesh <code>hooks</code> / config.toml).</div>
    {:else}
      <div class="table">
        {#each hooks as h (h.name)}
          <div class="hrow" class:muted={h.muted}>
            <div class="hmain">
              <span class="hname">{h.name}</span>
              <span class="hevent">{h.event}</span>
              {#if h.from || h.to}<span class="hflow">{h.from || '*'} → {h.to || '*'}</span>{/if}
              {#each [['agent', h.agent], ['machine', h.machine], ['tag', h.tag]] as [k, v]}
                {#if v}<span class="hmeta">{k}:{v}</span>{/if}
              {/each}
            </div>
            <code class="hcmd">{h.command}</code>
            <div class="hactions">
              <button onclick={() => test(h)} title="run synchronously now">Test</button>
              <button class:on={!h.muted} onclick={() => toggleMute(h)}>{h.muted ? 'Disabled' : 'Enabled'}</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
    {#if testOut}
      <div class="testout">
        <div class="to-head">
          <span>test · {testOut.name}</span>
          {#if testOut.running}<span class="warn">running…</span>{:else}<span class={testOut.ok ? 'ok' : 'bad'}>{testOut.ok ? 'ok' : 'failed'}</span>{/if}
          <button class="to-x" onclick={() => (testOut = null)} aria-label="dismiss">×</button>
        </div>
        {#if testOut.output}<pre>{testOut.output}</pre>{/if}
        {#if testOut.error}<pre class="err">{testOut.error}</pre>{/if}
      </div>
    {/if}
  </section>

  <section class="panel">
    <div class="phead">
      <span class="h">Subscriptions</span><span class="sub">subscriber ← subscribee (delivered on the subscribee's turn completion)</span>
      <div class="spacer"></div>
      {#if !adding}<button class="primary" onclick={() => (adding = true)}>+ Subscribe</button>{/if}
    </div>
    {#if adding}
      <div class="addsub">
        <label>Subscriber<select bind:value={newSubr}><option value="" disabled>thread…</option>{#each rows as r (r.id)}<option value={r.id}>{r.name || shortId(r.id)} ({r.agent_kind})</option>{/each}</select></label>
        <span class="arrow">←</span>
        <label>Subscribee<select bind:value={newSube}><option value="" disabled>thread…</option>{#each rows as r (r.id)}<option value={r.id}>{r.name || shortId(r.id)} ({r.agent_kind})</option>{/each}</select></label>
        <label class="cyc"><input type="checkbox" bind:checked={allowCycle} /> allow cycle</label>
        <button class="primary" onclick={addSub} disabled={!newSubr || !newSube}>Add</button>
        <button onclick={() => (adding = false)}>Cancel</button>
      </div>
    {/if}
    {#if subs.length === 0}
      <div class="empty">No subscriptions.</div>
    {:else}
      <div class="table">
        {#each subs as s (s.subscriber + '|' + s.subscribee)}
          <div class="srow">
            <span class="sname">{nameOf(s.subscriber)}</span>
            <span class="arrow">←</span>
            <span class="sname">{nameOf(s.subscribee)}</span>
            <div class="spacer"></div>
            <button class="danger" onclick={() => removeSub(s)}>Remove</button>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .wrap { height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 16px; display: flex; flex-direction: column; gap: 18px; }
  .panel { background: #0e0f17; border: 1px solid #1f2030; border-radius: 10px; padding: 14px 16px; }
  .phead { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
  .phead .h { font-size: 16px; font-weight: 600; }
  .phead .sub { font-size: 11px; color: #565f89; }
  .phead .spacer { flex: 1; }
  .empty { color: #565f89; font-size: 13px; padding: 8px 2px; }
  .empty code, code { font-family: ui-monospace, monospace; }
  .table { display: flex; flex-direction: column; gap: 6px; }
  .hrow { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center;
    background: #16161e; border: 1px solid #232433; border-radius: 8px; padding: 9px 12px; }
  .hrow.muted { opacity: 0.55; }
  .hmain { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  .hname { font-weight: 600; font-size: 13px; }
  .hevent { font-size: 11px; color: #7aa2f7; font-family: ui-monospace, monospace; }
  .hflow { font-size: 11px; color: #9ece6a; }
  .hmeta { font-size: 10px; color: #565f89; }
  .hcmd { grid-column: 1 / 2; font-size: 11px; color: #9aa5ce; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hactions { grid-row: 1 / span 2; display: flex; gap: 6px; align-items: center; }
  .hactions button, .addsub button, .srow button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d;
    border-radius: 6px; padding: 5px 11px; font-size: 12px; cursor: pointer; }
  .hactions button.on { background: #1b3a2b; color: #9ece6a; border-color: #2f5a30; }
  .testout { margin-top: 12px; background: #0b0c12; border: 1px solid #2a2b3d; border-radius: 8px; padding: 10px 12px; }
  .to-head { display: flex; align-items: center; gap: 10px; font-size: 12px; font-family: ui-monospace, monospace; }
  .to-head .ok { color: #9ece6a; } .to-head .bad { color: #f7768e; } .to-head .warn { color: #e0af68; }
  .to-head .to-x { margin-left: auto; background: none; border: 0; color: #9aa5ce; cursor: pointer; font-size: 16px; }
  .testout pre { margin: 8px 0 0; font-size: 11px; color: #c0caf5; white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow: auto; }
  .testout pre.err { color: #ffb4c0; }
  .addsub { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;
    background: #16161e; border: 1px solid #232433; border-radius: 8px; padding: 10px 12px; }
  .addsub label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #565f89; }
  .addsub .cyc { flex-direction: row; align-items: center; gap: 5px; color: #9aa5ce; }
  .addsub select { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px; padding: 6px 8px; font-size: 12px; }
  .arrow { color: #7aa2f7; font-size: 14px; padding: 0 2px; }
  .primary { background: #7aa2f7 !important; color: #11121a !important; border: 0 !important; font-weight: 600; }
  .srow { display: flex; align-items: center; gap: 10px; background: #16161e; border: 1px solid #232433;
    border-radius: 8px; padding: 9px 12px; }
  .srow .sname { font-size: 13px; }
  .srow .spacer { flex: 1; }
  .srow .danger { color: #ffb4c0; border-color: #5a2030; }
</style>
