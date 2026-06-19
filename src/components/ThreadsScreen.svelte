<script>
  // The home screen: a live thread grid (parent/child tree, head/busy glyphs, filter, archived
  // toggle, ticket badges) on the left; a detail header + the right chat surface on the right.
  // Lifecycle verbs emit through seshClient; their failures go to the loud global toast store,
  // kept separate from the live-poll model so a poll tick never wipes an action error.
  import { api } from '../lib/seshClient.js'
  import { glyph, stateLabel, surfaceFor, rpcLive, shortId } from '../lib/format.js'
  import { pushError, pushInfo } from '../lib/toasts.svelte.js'
  import { poll } from '../lib/connection.svelte.js'
  import RpcChat from './chat/RpcChat.svelte'
  import Terminal from './chat/Terminal.svelte'
  import HeadlessChat from './chat/HeadlessChat.svelte'
  import NewThreadModal from './NewThreadModal.svelte'
  import PromptDialog from './PromptDialog.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'

  let rows = $state([])
  let selectedId = $state(null)
  let mode = $state('auto')          // surface override: auto | rpc | terminal | headless
  let filter = $state('')
  let showArchived = $state(false)
  let newParent = $state(undefined)  // undefined = modal closed; '' = root; id = child
  let renameTarget = $state(null)    // thread being renamed (in-app dialog, not window.prompt)
  let deleteTarget = $state(null)    // thread pending delete confirmation

  async function refresh() {
    // Background poll: report reachability to the shared connection store (→ one banner),
    // never a per-tick toast. On failure keep the last-known rows rather than blanking.
    try { rows = (await poll(api.grid({ archived: showArchived }))).rows || [] }
    catch {}
  }
  $effect(() => { showArchived; refresh() })           // immediate refetch when the toggle flips
  $effect(() => { const t = setInterval(refresh, 2500); return () => clearInterval(t) })

  let selected = $derived(rows.find((r) => r.id === selectedId) || null)

  // Build the flattened, depth-annotated tree for display (DFS from roots; a row whose parent
  // isn't in the current set is treated as a root so nothing is orphaned out of view).
  let tree = $derived.by(() => {
    const ids = new Set(rows.map((r) => r.id))
    const children = new Map()
    const roots = []
    for (const r of rows) {
      const p = r.parent && ids.has(r.parent) ? r.parent : null
      if (p) { (children.get(p) ?? children.set(p, []).get(p)).push(r) }
      else roots.push(r)
    }
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
    const out = []
    const walk = (r, depth) => {
      out.push({ row: r, depth })
      ;(children.get(r.id) || []).sort(byName).forEach((c) => walk(c, depth + 1))
    }
    roots.sort(byName).forEach((r) => walk(r, 0))
    return out
  })

  let filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return tree
    // When filtering, drop the tree indent and show flat matches by name/agent/cwd.
    return tree
      .filter(({ row }) => `${row.name} ${row.agent_kind} ${row.cwd_rel || row.cwd}`.toLowerCase().includes(q))
      .map(({ row }) => ({ row, depth: 0 }))
  })

  function select(r) { selectedId = r.id; mode = 'auto' }

  async function act(label, fn) {
    try { await fn(); await refresh() }
    catch (e) { pushError(`${label}: ${e.message ?? e}`) }
  }
  async function doRename(name) {
    const r = renameTarget
    renameTarget = null
    if (name == null || name === r.name) return
    await act('rename', () => api.rename(r.id, name))
  }
  async function doDelete() {
    const r = deleteTarget
    deleteTarget = null
    const force = r.head === 'headful'
    try {
      await api.del(r.id, force)
      if (selectedId === r.id) selectedId = null
      await refresh()
    } catch (e) { pushError(`delete: ${e.message ?? e}`) }
  }
  async function onCreated(id) {
    newParent = undefined
    await refresh()
    const r = rows.find((x) => x.id === id)
    if (r) select(r)
    pushInfo('Thread created')
  }

  let surface = $derived(
    !selected ? 'none'
      : mode !== 'auto' ? mode
        : surfaceFor(selected)
  )
</script>

<div class="screen">
  <aside>
    <div class="head">
      <span>Threads</span>
      <button class="new" onclick={() => (newParent = '')}>+ New</button>
    </div>
    <div class="controls">
      <input class="filter" bind:value={filter} placeholder="filter…" />
      <label class="arch"><input type="checkbox" bind:checked={showArchived} /> archived</label>
    </div>
    <div class="list">
      {#each filtered as { row, depth } (row.id)}
        <button class="row {selectedId === row.id ? 'sel' : ''}" style="padding-left:{14 + depth * 16}px" onclick={() => select(row)}>
          <span class="g {row.busy === 'busy' ? 'busy' : ''}">{glyph(row)}</span>
          <span class="nm">{row.name || '(nameless)'}{#if row.archived}<span class="archtag"> ·archived</span>{/if}</span>
          <span class="st">{stateLabel(row)}</span>
          <span class="agent">
            {row.agent_kind}
            {#if row.tickets_open}<span class="tkt" class:needs={row.ticket_needs_input}>🎫{row.tickets_open}</span>{/if}
          </span>
        </button>
      {/each}
      {#if filtered.length === 0}<div class="empty">{filter ? 'no matches' : 'no threads — click “+ New”.'}</div>{/if}
    </div>
  </aside>

  <main>
    {#if !selected}
      <div class="placeholder">Select a thread to chat with it.</div>
    {:else}
      <header>
        <div class="title">
          <span class="g {selected.busy === 'busy' ? 'busy' : ''}">{glyph(selected)}</span>
          <span class="name">{selected.name || '(nameless)'}</span>
          <span class="sub">{selected.agent_kind} · {stateLabel(selected)} · {selected.cwd_rel || selected.cwd}</span>
        </div>
        <div class="actions">
          <div class="seg">
            {#if selected.agent_kind === 'pi'}
              <button class:on={surface === 'rpc'} class:muted={!rpcLive(selected)} onclick={() => (mode = 'rpc')}
                title={rpcLive(selected) ? 'live pi RPC stream' : 'pi RPC connects once a pi process is live (headful, or a turn in flight)'}>RPC</button>
            {/if}
            {#if selected.head === 'headful'}
              <button class:on={surface === 'terminal'} onclick={() => (mode = 'terminal')}>Terminal</button>
            {/if}
            <button class:on={surface === 'headless'} onclick={() => (mode = 'headless')}>Transcript</button>
          </div>
          {#if selected.head === 'headful'}
            <button onclick={() => act('stop', () => api.stop(selected.id))}>Stop</button>
          {:else}
            <button onclick={() => act('resume', () => api.resume(selected.id))}>Resume</button>
            <button onclick={() => act('headful', () => api.headful(selected.id))}>Headful</button>
          {/if}
          <button onclick={() => (newParent = selected.id)} title="new child thread">+ Child</button>
          <button onclick={() => (renameTarget = selected)}>Rename</button>
          <button onclick={() => act('archive', () => api.archive(selected.id, !selected.archived))}>{selected.archived ? 'Unarchive' : 'Archive'}</button>
          <button class="danger" onclick={() => (deleteTarget = selected)}>Delete</button>
        </div>
      </header>
      <section class="surface">
        {#if surface === 'rpc'}
          {#key selected.id + mode}<RpcChat threadId={selected.id} />{/key}
        {:else if surface === 'terminal'}
          {#key selected.id}<Terminal threadId={selected.id} />{/key}
        {:else if surface === 'headless'}
          {#key selected.id}<HeadlessChat threadId={selected.id} agentKind={selected.agent_kind} />{/key}
        {/if}
      </section>
    {/if}
  </main>

  {#if newParent !== undefined}
    <NewThreadModal parent={newParent} onclose={() => (newParent = undefined)} oncreated={onCreated} />
  {/if}

  {#if renameTarget}
    <PromptDialog title="Rename thread" label="Name" value={renameTarget.name || ''}
      placeholder="(nameless)" confirmLabel="Rename"
      onsubmit={doRename} oncancel={() => (renameTarget = null)} />
  {/if}

  {#if deleteTarget}
    <ConfirmDialog title="Delete thread?" danger confirmLabel="Delete"
      message={`"${deleteTarget.name || shortId(deleteTarget.id)}" — ${deleteTarget.head === 'headful' ? 'its runtime is LIVE; this orphans the agent (--force).' : 'the record only.'}`}
      onconfirm={doDelete} oncancel={() => (deleteTarget = null)} />
  {/if}
</div>

<style>
  .screen { display: grid; grid-template-columns: 320px 1fr; height: 100%; min-height: 0; }
  aside { background: #0e0f17; border-right: 1px solid #1f2030; display: flex; flex-direction: column; min-height: 0; }
  .head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 8px; font-weight: 600; }
  .head .new { background: #7aa2f7; color: #11121a; border: 0; border-radius: 6px; padding: 4px 10px;
    font-size: 12px; font-weight: 600; cursor: pointer; }
  .controls { display: flex; gap: 8px; align-items: center; padding: 0 12px 10px; }
  .filter { flex: 1; background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px;
    padding: 6px 9px; font-size: 12px; }
  .arch { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #9aa5ce; white-space: nowrap; }
  .list { flex: 1; overflow-y: auto; }
  .row { width: 100%; text-align: left; display: grid; grid-template-columns: 22px 1fr auto;
    gap: 2px 8px; align-items: center; background: none; border: 0; color: inherit; padding: 9px 14px;
    cursor: pointer; border-left: 2px solid transparent; }
  .row:hover { background: #15161f; }
  .row.sel { background: #181a26; border-left-color: #7aa2f7; }
  .row .g { font-size: 14px; color: #565f89; grid-row: 1 / span 2; }
  .row .g.busy { color: #e0af68; }
  .row .nm { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .archtag { color: #565f89; font-size: 10px; }
  .row .st { font-size: 10px; color: #9aa5ce; text-align: right; }
  .row .agent { grid-column: 2 / span 2; font-size: 10px; color: #565f89; display: flex; gap: 6px; align-items: center; }
  .row .tkt { color: #e0af68; }
  .row .tkt.needs { color: #f7768e; }
  .empty, .placeholder { color: #565f89; padding: 20px; }
  main { display: flex; flex-direction: column; min-width: 0; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;
    border-bottom: 1px solid #1f2030; background: #0e0f17; gap: 12px; flex-shrink: 0; }
  .title { font-size: 15px; font-weight: 600; min-width: 0; display: flex; align-items: baseline; gap: 8px; overflow: hidden; }
  .title .g { color: #e0af68; }
  .title .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title .sub { font-size: 11px; color: #565f89; font-weight: 400; white-space: nowrap; }
  .actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
  .seg { display: flex; border: 1px solid #2a2b3d; border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; border-radius: 0; background: #1a1b26; color: #9aa5ce; padding: 5px 11px;
    font-size: 12px; cursor: pointer; }
  .seg button.on { background: #e0af68; color: #16161e; font-weight: 600; }
  .seg button.muted:not(.on) { color: #565f89; }
  .actions > button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px;
    padding: 5px 12px; cursor: pointer; font-size: 12px; }
  .actions > button:hover { background: #232433; }
  .actions .danger { color: #ffb4c0; border-color: #5a2030; }
  .surface { flex: 1; min-height: 0; }
  .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 14px; }
</style>
