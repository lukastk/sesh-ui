<script>
  // The home screen: a live thread grid (parent/child tree, head/busy glyphs, filter, archived
  // toggle, ticket badges) on the left; a detail header + the right chat surface on the right.
  // Lifecycle verbs emit through seshClient; their failures go to the loud global toast store,
  // kept separate from the live-poll model so a poll tick never wipes an action error.
  import { api, sesh } from '../lib/seshClient.js'
  import { glyph, stateLabel, surfaceFor, rpcLive, shortId } from '../lib/format.js'
  import { pushError, pushInfo } from '../lib/toasts.svelte.js'
  import { poll, conn } from '../lib/connection.svelte.js'
  import { copyText } from '../lib/clipboard.js'
  import { cacheSet, cacheGet } from '../lib/snapshot.svelte.js'
  import RpcChat from './chat/RpcChat.svelte'
  import Terminal from './chat/Terminal.svelte'
  import HeadlessChat from './chat/HeadlessChat.svelte'
  import NewThreadModal from './NewThreadModal.svelte'
  import PromptDialog from './PromptDialog.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import ContextMenu from './ContextMenu.svelte'
  import { longpress } from '../lib/longpress.js'
  import { registerBack } from '../lib/back.js'

  // Seed from the offline cache (Android) so a cold start with no connectivity shows last-known
  // threads immediately, behind the loud offline banner; '' off Android (cacheGet is a no-op there).
  let rows = $state(cacheGet('grid')?.data || [])
  let selectedId = $state(null)
  let mode = $state('auto')          // surface override: auto | rpc | terminal | headless
  let filter = $state('')
  let showArchived = $state(false)
  // Default ON: show the WHOLE mesh (matches `sesh tui`, whose wrapper adds --all-machines).
  // The daemon fans out to its peers; threads on other machines appear with their own row.machine.
  let showAllMachines = $state(true)
  let newParent = $state(undefined)  // undefined = modal closed; '' = root; id = child
  let forkTarget = $state(null)      // thread being forked (opens the modal in fork mode)
  let renameTarget = $state(null)    // thread being renamed (in-app dialog, not window.prompt)
  let deleteTarget = $state(null)    // thread pending delete confirmation

  // Tree fold (like the TUI). The DEFAULT collapsed state for parents comes from the connected
  // daemon's ui_config.collapse_parents (fetched on load); a user can expand/collapse individual
  // parents within the session via `overrides` (ids whose state differs from the default).
  let collapseDefault = $state(true)        // ui_config.collapse_parents (default true)
  let overrides = $state(new Set())         // parent ids toggled away from the default (session-only)
  const isCollapsed = (id) => collapseDefault !== overrides.has(id) // default XOR overridden
  function toggleCollapse(id) {
    const n = new Set(overrides)
    n.has(id) ? n.delete(id) : n.add(id)
    overrides = n
  }
  // Fetch the per-daemon UI config once on load → set the parent-collapse default.
  $effect(() => {
    api.uiConfigGet()
      .then((r) => { collapseDefault = r.ui_config?.collapse_parents ?? true; overrides = new Set() })
      .catch(() => {}) // pre-24 daemon → keep the default (collapsed)
  })

  async function refresh() {
    // Background poll: report reachability to the shared connection store (→ one banner),
    // never a per-tick toast. On failure keep the last-known rows rather than blanking.
    try { rows = (await poll(api.grid({ archived: showArchived, allMachines: showAllMachines }))).rows || []; cacheSet('grid', rows) }
    catch {}
  }
  $effect(() => { showArchived; showAllMachines; refresh() })   // immediate refetch when a toggle flips
  $effect(() => { const t = setInterval(refresh, 2500); return () => clearInterval(t) })

  // Cross-machine chat: a thread on ANOTHER machine has its rpc/terminal pane + transcript on that
  // machine's daemon. We dial that thread's OWNING daemon directly (Electron main holds the peer
  // token, from peers.json). `dialable` is the set of peer machines we can reach for chat; for a
  // remote thread NOT in it (e.g. web/dev, or an ssh-only peer) we keep the read-only notice.
  let dialable = $state(new Set())
  $effect(() => { sesh.peerInfo().then((i) => { dialable = new Set(i.peers || []) }).catch(() => {}) })

  let selected = $derived(rows.find((r) => r.id === selectedId) || null)
  let isRemote = $derived(!!(selected && conn.machine && selected.machine !== conn.machine))
  let canDialRemote = $derived(isRemote && dialable.has(selected.machine))
  // The machine to hand the chat surface: the owning machine for a dial-able remote thread, else
  // undefined (the local/connected daemon).
  let chatMachine = $derived(canDialRemote ? selected.machine : undefined)
  // Only block the chat surface when the remote thread is NOT dial-able from here.
  let blockedRemote = $derived(isRemote && !canDialRemote)

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
      const kids = children.get(r.id) || []
      const fold = kids.length > 0 && isCollapsed(r.id)
      out.push({ row: r, depth, hasChildren: kids.length > 0, collapsed: fold })
      // Fold: skip a collapsed parent's subtree entirely (its rows leave the flattened list).
      if (kids.length && !fold) kids.sort(byName).forEach((c) => walk(c, depth + 1))
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
      .map(({ row }) => ({ row, depth: 0, hasChildren: false, collapsed: false }))
  })

  function select(r) { selectedId = r.id; mode = 'auto' }

  function copyId(id) { copyText(id) ? pushInfo('Copied full id') : pushError('copy failed') }

  // Resizable sidebar (desktop). A pointer-drag handle (NOT HTML5 drag) updates the grid column
  // width, clamped 200–600, persisted to localStorage. The phone layout (≤720px) collapses the
  // sidebar, so the handle is hidden there.
  let sidebarWidth = $state(loadSidebarW())
  let resizing = $state(false)
  function loadSidebarW() {
    const v = Number(localStorage.getItem('seshui.sidebarWidth'))
    return v >= 200 && v <= 600 ? v : 320
  }
  function startResize(e) {
    e.preventDefault()
    resizing = true
    const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--font-scale')) || 1
    const onMove = (ev) => { sidebarWidth = Math.min(600, Math.max(200, Math.round(ev.clientX / scale))) }
    const onUp = () => {
      resizing = false
      try { localStorage.setItem('seshui.sidebarWidth', String(sidebarWidth)) } catch {}
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Right-click (desktop) / long-press (Android, separate branch) → the reusable ContextMenu with
  // this row's existing actions. openRowMenu is shared: desktop passes the contextmenu event; the
  // long-press util passes { x, y }.
  let ctxMenu = $state(null)   // { x, y, items } | null
  function rowMenuItems(row) {
    const items = []
    if (row.head === 'headful') items.push({ label: 'Stop', onselect: () => act('stop', () => api.stop(row.id, row.machine)) })
    else items.push({ label: 'Open pane', onselect: () => act('resume', () => api.resume(row.id, row.machine)) })
    items.push({ separator: true })
    items.push({ label: '+ Child thread', onselect: () => (newParent = row.id) })
    items.push({ label: 'Fork', onselect: () => (forkTarget = row) })
    items.push({ label: 'Set parent…', onselect: () => { selectedId = row.id; reparentPick = true } })
    items.push({ label: 'Rename', onselect: () => (renameTarget = row) })
    items.push({ label: row.archived ? 'Unarchive' : 'Archive', onselect: () => act('archive', () => api.archive(row.id, !row.archived, row.machine)) })
    items.push({ separator: true })
    items.push({ label: 'Delete', danger: true, onselect: () => (deleteTarget = row) })
    return items
  }
  function openRowMenu(x, y, row) { selectedId = row.id; ctxMenu = { x, y, items: rowMenuItems(row) } }

  // Tags (chip strip on the detail header) — add/remove via POST /v1/threads/tag.
  let tagDraft = $state('')
  async function addTag() {
    const t = tagDraft.trim()
    if (!t || !selected) return
    tagDraft = ''
    await act('tag', () => api.tag(selected.id, [t], undefined, selected.machine))
  }
  async function removeTag(t) { await act('untag', () => api.tag(selected.id, undefined, [t], selected.machine)) }

  // Reparent via drag-drop: drag a row onto another (→ that becomes its parent) or onto the
  // "drop to root" zone (→ a root). Reparent errors (cycle/self/unknown) surface as a loud toast.
  let dragId = $state(null)
  let dropOn = $state(null)         // row id currently hovered as a drop target ('' = root zone)
  function onDragStart(e, id) { dragId = id; e.dataTransfer.effectAllowed = 'move' }
  function onDragEnd() { dragId = null; dropOn = null }
  async function onDropRow(targetId) {
    const id = dragId
    dropOn = null; dragId = null
    if (!id || id === targetId) return
    await reparentTo(id, targetId)
  }
  // Click-based reparent (the drag-free, testable path): a "Set parent…" picker. The daemon
  // rejects self/cycle/unknown loudly → a toast.
  let reparentPick = $state(false)

  // Android "back" (edge-swipe / back button): peel off any open overlay topmost-first, then leave a
  // selected thread's detail for the list (the ticket's example). Returns true once it consumes the
  // back; false (nothing open, no selection) lets App fall through to exit.
  $effect(() => registerBack(() => {
    if (ctxMenu) { ctxMenu = null; return true }
    if (reparentPick) { reparentPick = false; return true }
    if (deleteTarget) { deleteTarget = null; return true }
    if (renameTarget) { renameTarget = null; return true }
    if (forkTarget) { forkTarget = null; return true }
    if (newParent !== undefined) { newParent = undefined; return true }
    if (selectedId) { selectedId = null; return true }
    return false
  }))
  async function reparentTo(id, parentId) {
    reparentPick = false
    const m = rows.find((r) => r.id === id)?.machine // route to the (re-parented) thread's owner
    await act('reparent', () => api.reparent(id, parentId, m)) // '' parentId = make root
  }

  async function act(label, fn) {
    try { await fn(); await refresh() }
    catch (e) { pushError(`${label}: ${e.message ?? e}`) }
  }
  async function doRename(name) {
    const r = renameTarget
    renameTarget = null
    if (name == null || name === r.name) return
    await act('rename', () => api.rename(r.id, name, r.machine))
  }
  async function doDelete() {
    const r = deleteTarget
    deleteTarget = null
    const force = r.head === 'headful'
    try {
      await api.del(r.id, force, r.machine)
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

<div class="screen" class:detail={!!selected} class:resizing style="--sidebar-w:{sidebarWidth}px">
  <aside>
    <div class="head">
      <span>Threads</span>
      <button class="new" onclick={() => (newParent = '')}>+ New</button>
    </div>
    <div class="controls">
      <input class="filter" bind:value={filter} placeholder="filter…" />
      <label class="arch"><input type="checkbox" bind:checked={showArchived} /> archived</label>
      <label class="arch" title="show threads from every machine in the mesh (like sesh tui)"><input type="checkbox" bind:checked={showAllMachines} /> all&nbsp;machines</label>
    </div>
    {#if dragId}
      <div class="root-drop" class:over={dropOn === ''}
        ondragover={(e) => { e.preventDefault(); dropOn = '' }} ondragleave={() => (dropOn = null)}
        ondrop={(e) => { e.preventDefault(); onDropRow('') }} role="presentation">↥ drop here to make a root thread</div>
    {/if}
    <div class="list">
      {#each filtered as { row, depth, hasChildren, collapsed } (row.id)}
        <button class="row {selectedId === row.id ? 'sel' : ''}" class:dragging={dragId === row.id} class:dropover={dropOn === row.id}
          style="padding-left:{20 + depth * 16}px" onclick={() => select(row)}
          draggable="true" ondragstart={(e) => onDragStart(e, row.id)} ondragend={onDragEnd}
          ondragover={(e) => { if (dragId && dragId !== row.id) { e.preventDefault(); dropOn = row.id } }}
          ondragleave={() => { if (dropOn === row.id) dropOn = null }}
          ondrop={(e) => { e.preventDefault(); onDropRow(row.id) }}
          oncontextmenu={(e) => { e.preventDefault(); openRowMenu(e.clientX, e.clientY, row) }}
          use:longpress={{ onlongpress: (e) => openRowMenu(e.x, e.y, row) }}
          title={dragId ? 'drop to set as parent' : ''}>
          {#if hasChildren}
            <span class="fold" style="left:{depth * 16}px" role="button" tabindex="-1"
              title={collapsed ? 'expand' : 'collapse'}
              onclick={(e) => { e.stopPropagation(); toggleCollapse(row.id) }}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggleCollapse(row.id) } }}>{collapsed ? '▸' : '▾'}</span>
          {/if}
          <span class="g {row.busy === 'busy' ? 'busy' : ''}">{glyph(row)}</span>
          <span class="nm">{row.name || '(nameless)'}{#if row.archived}<span class="archtag"> ·archived</span>{/if}</span>
          <span class="st">{stateLabel(row)}</span>
          <span class="agent">
            {row.agent_kind}
            {#if conn.machine && row.machine !== conn.machine}<span class="mach" title="lives on {row.machine}">⌘ {row.machine}</span>{/if}
            {#if row.tickets_open}<span class="tkt" class:needs={row.ticket_needs_input}>🎫{row.tickets_open}</span>{/if}
          </span>
        </button>
      {/each}
      {#if filtered.length === 0}<div class="empty">{filter ? 'no matches' : 'no threads — click “+ New”.'}</div>{/if}
    </div>
  </aside>

  <div class="resizer" class:active={resizing} style="left:calc(var(--sidebar-w) - 3px)"
    onpointerdown={startResize} role="separator" aria-label="resize sidebar"
    title="drag to resize · double-click to reset" ondblclick={() => { sidebarWidth = 320; try { localStorage.setItem('seshui.sidebarWidth', '320') } catch {} }}></div>

  <main>
    {#if !selected}
      <div class="placeholder">Select a thread to chat with it.</div>
    {:else}
      <header>
        <button class="back" onclick={() => (selectedId = null)} aria-label="back to thread list" title="back to threads">‹</button>
        <div class="title">
          <span class="g {selected.busy === 'busy' ? 'busy' : ''}">{glyph(selected)}</span>
          <span class="name">{selected.name || '(nameless)'}</span>
          <button class="copyid" onclick={() => copyId(selected.id)} title={`copy full id: ${selected.id}`}>⧉ {shortId(selected.id)}</button>
          <span class="sub">{selected.agent_kind} · {stateLabel(selected)} · {selected.cwd_rel || selected.cwd}{#if selected.model} · <span class="modeltag" title="pinned model">{selected.model}</span>{/if}</span>
        </div>
        <div class="actions">
          {#if !blockedRemote}
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
          {/if}
          {#if selected.head === 'headful'}
            <button onclick={() => act('stop', () => api.stop(selected.id, selected.machine))} title="end the live pane (keeps the thread, resumable)">Stop</button>
          {:else}
            <!-- resume and headful are the SAME daemon op (revive an idle thread into a live pane);
                 one button. (send-headless, in the chat composer, is a stateless turn with no pane.) -->
            <button onclick={() => act('resume', () => api.resume(selected.id, selected.machine))} title="revive this thread into a live tmux pane (a.k.a. headful)">Open pane</button>
          {/if}
          <button onclick={() => (newParent = selected.id)} title="new child thread">+ Child</button>
          <button onclick={() => (reparentPick = true)} title="set this thread's parent (or drag a row onto another)">Set parent…</button>
          <button onclick={() => (forkTarget = selected)} title="branch this conversation into a new thread">Fork</button>
          <button onclick={() => act('notify', () => api.notify(selected.id, !selected.notify, selected.machine))}
            title={selected.notify ? 'notifications on — click to mute' : 'notifications muted — click to enable'}>{selected.notify ? '🔔' : '🔕'}</button>
          <button onclick={() => (renameTarget = selected)}>Rename</button>
          <button onclick={() => act('archive', () => api.archive(selected.id, !selected.archived, selected.machine))}>{selected.archived ? 'Unarchive' : 'Archive'}</button>
          <button class="danger" onclick={() => (deleteTarget = selected)}>Delete</button>
        </div>
      </header>
      <div class="tagbar">
        <span class="tg-label">tags</span>
        {#each selected.tags || [] as t (t)}
          <span class="tg-chip">{t}<button onclick={() => removeTag(t)} aria-label="remove tag {t}">×</button></span>
        {/each}
        <input class="tg-input" bind:value={tagDraft} placeholder="+ add tag"
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
      </div>
      <section class="surface">
        {#if blockedRemote}
          <div class="remote-notice">
            <div class="rn-emoji">🌐</div>
            <div class="rn-title">This thread lives on <b>{selected.machine}</b>.</div>
            <div class="rn-body">
              You're connected to <b>{conn.machine}</b>, and there's no dial-able API endpoint for
              <b>{selected.machine}</b> from here (it's ssh-only in peers.json, or this is the web/dev
              build). Its live pane and transcript are served by that machine's own daemon. It still
              shows in the grid, tickets and machines; only its chat is unavailable from this connection.
            </div>
          </div>
        {:else if surface === 'rpc'}
          {#key selected.id + mode}<RpcChat threadId={selected.id} machine={chatMachine} />{/key}
        {:else if surface === 'terminal'}
          {#key selected.id}<Terminal threadId={selected.id} machine={chatMachine} />{/key}
        {:else if surface === 'headless'}
          {#key selected.id}<HeadlessChat threadId={selected.id} agentKind={selected.agent_kind} machine={chatMachine} headful={selected.head === 'headful'} busy={selected.busy} />{/key}
        {/if}
      </section>
    {/if}
  </main>

  {#if newParent !== undefined}
    <NewThreadModal parent={newParent} onclose={() => (newParent = undefined)} oncreated={onCreated} />
  {/if}

  {#if forkTarget}
    <NewThreadModal forkFrom={forkTarget.id} forkAgent={forkTarget.agent_kind}
      forkName={forkTarget.name || ''} forkCwd={forkTarget.cwd_rel || forkTarget.cwd || '~'}
      onclose={() => (forkTarget = null)} oncreated={(id) => { forkTarget = null; onCreated(id) }} />
  {/if}

  {#if reparentPick && selected}
    <div class="backdrop" onclick={() => (reparentPick = false)} role="presentation">
      <div class="rp" onclick={(e) => e.stopPropagation()} role="dialog">
        <h3>Set parent of “{selected.name || shortId(selected.id)}”</h3>
        <div class="rplist">
          <button class="rprow root" onclick={() => reparentTo(selected.id, '')}>↥ (make a root thread)</button>
          {#each rows.filter((r) => r.id !== selected.id) as r (r.id)}
            <button class="rprow" onclick={() => reparentTo(selected.id, r.id)}>
              <span class="g">{glyph(r)}</span>
              <span class="nm">{r.name || shortId(r.id)}</span>
              <span class="ag">{r.agent_kind}</span>
            </button>
          {/each}
        </div>
        <div class="rpfoot"><button onclick={() => (reparentPick = false)}>Cancel</button></div>
      </div>
    </div>
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

  {#if ctxMenu}
    <ContextMenu items={ctxMenu.items} x={ctxMenu.x} y={ctxMenu.y} onclose={() => (ctxMenu = null)} />
  {/if}
</div>

<style>
  .screen { position: relative; display: grid; grid-template-columns: var(--sidebar-w, 320px) 1fr; height: 100%; min-height: 0; }
  .screen.resizing { cursor: col-resize; user-select: none; }
  .resizer { position: absolute; top: 0; bottom: 0; width: 7px; z-index: 8; cursor: col-resize; }
  .resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: transparent; }
  .resizer:hover::after, .resizer.active::after { background: #7aa2f7; box-shadow: 0 0 5px #7aa2f788; }
  aside { background: #0e0f17; border-right: 1px solid #1f2030; display: flex; flex-direction: column; min-height: 0; }
  .head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 8px; font-weight: 600; }
  .head .new { background: #7aa2f7; color: #11121a; border: 0; border-radius: 6px; padding: 4px 10px;
    font-size: 12px; font-weight: 600; cursor: pointer; }
  .controls { display: flex; gap: 8px; align-items: center; padding: 0 12px 10px; }
  .filter { flex: 1; background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px;
    padding: 6px 9px; font-size: 12px; }
  .arch { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #9aa5ce; white-space: nowrap; }
  .list { flex: 1; overflow-y: auto; overscroll-behavior: contain; }
  .row { position: relative; width: 100%; text-align: left; display: grid; grid-template-columns: 22px 1fr auto;
    gap: 2px 8px; align-items: center; background: none; border: 0; color: inherit; padding: 9px 14px;
    cursor: pointer; border-left: 2px solid transparent; }
  .fold { position: absolute; top: 0; bottom: 0; width: 20px; display: flex; align-items: center;
    justify-content: center; color: #565f89; font-size: 14px; cursor: pointer; user-select: none; }
  .fold:hover { color: #c0caf5; }
  .row.dragging { opacity: 0.45; }
  .row.dropover { background: #1c2a3a; border-left-color: #7dcfff; box-shadow: inset 0 0 0 1px #1e3a4a; }
  .root-drop { margin: 6px 10px; padding: 8px; text-align: center; font-size: 11px; color: #7dcfff;
    border: 1px dashed #1e3a4a; border-radius: 7px; background: #11202b; }
  .root-drop.over { background: #1c2a3a; border-color: #7dcfff; }
  .row:hover { background: #15161f; }
  .row.sel { background: #181a26; border-left-color: #7aa2f7; }
  .row .g { font-size: 14px; color: #565f89; grid-row: 1 / span 2; }
  .row .g.busy { color: #e0af68; }
  .row .nm { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .archtag { color: #565f89; font-size: 10px; }
  .row .st { font-size: 10px; color: #9aa5ce; text-align: right; }
  .row .agent { grid-column: 2 / span 2; font-size: 10px; color: #565f89; display: flex; gap: 6px; align-items: center; }
  .row .mach { color: #7dcfff; background: #142733; border: 1px solid #1e3a4a; border-radius: 4px; padding: 0 4px; }
  .row .tkt { color: #e0af68; }
  .row .tkt.needs { color: #f7768e; }
  .empty, .placeholder { color: #565f89; padding: 20px; }
  /* min-height:0 is load-bearing: without it this grid item grows to its content height (a long
     transcript) and overflows the page instead of letting .surface/.log scroll internally. */
  main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
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
  .title .sub .modeltag { color: #7dcfff; }
  .copyid { background: #1a1b26; color: #7dcfff; border: 1px solid #2a2b3d; border-radius: 5px;
    padding: 1px 7px; font-size: 10px; font-family: ui-monospace, monospace; cursor: pointer; flex-shrink: 0; }
  .copyid:hover { background: #232433; }
  .tagbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 7px 16px;
    border-bottom: 1px solid #1f2030; background: #0c0d14; }
  .tagbar .tg-label { font-size: 10px; color: #565f89; text-transform: uppercase; letter-spacing: 0.05em; }
  .tg-chip { display: inline-flex; align-items: center; gap: 4px; background: #1a2733; color: #7dcfff;
    border: 1px solid #1e3a4a; border-radius: 12px; padding: 2px 4px 2px 9px; font-size: 11px; }
  .tg-chip button { background: none; border: 0; color: #7dcfff; cursor: pointer; font-size: 13px; line-height: 1; padding: 0 2px; }
  .tg-input { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 12px;
    padding: 3px 10px; font-size: 11px; width: 110px; }
  .surface { flex: 1; min-height: 0; }
  .remote-notice { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; text-align: center; padding: 24px; max-width: 560px; margin: 0 auto; }
  .remote-notice .rn-emoji { font-size: 34px; }
  .remote-notice .rn-title { font-size: 16px; color: #c0caf5; }
  .remote-notice .rn-title b, .remote-notice .rn-body b { color: #7dcfff; }
  .remote-notice .rn-body { font-size: 13px; color: #9aa5ce; line-height: 1.55; }
  .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 14px; }
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center;
    justify-content: center; z-index: 50; }
  .rp { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 16px 18px; width: 460px;
    max-width: 92vw; display: flex; flex-direction: column; gap: 10px; }
  .rp h3 { margin: 0; font-size: 15px; }
  .rplist { max-height: 340px; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column;
    gap: 3px; border: 1px solid #1f2030; border-radius: 8px; padding: 6px; }
  .rprow { display: flex; align-items: center; gap: 8px; text-align: left; background: none; border: 0;
    color: #c0caf5; padding: 7px 9px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .rprow:hover { background: #1c1d2b; }
  .rprow.root { color: #7dcfff; }
  .rprow .g { color: #565f89; font-size: 12px; } .rprow .nm { flex: 1; } .rprow .ag { font-size: 10px; color: #565f89; }
  .rpfoot { display: flex; justify-content: flex-end; }
  .rpfoot button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 6px 14px; cursor: pointer; font-size: 12px; }

  /* Back button: only on phone width (the two panes become one — see the media query). */
  .back { display: none; background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d;
    border-radius: 6px; font-size: 18px; line-height: 1; padding: 2px 11px; cursor: pointer; flex-shrink: 0; }

  /* Phone width: the desktop two-pane (list | chat) becomes a single pane — the list, OR the
     selected thread's detail+chat (with a ‹ back button). This removes the horizontal overflow
     that made the whole page scroll and pushed modals off-screen. */
  @media (max-width: 720px) {
    .screen { grid-template-columns: 1fr; }     /* collapse: the sidebar-width var doesn't apply on phone */
    .resizer { display: none; }                 /* no resize handle in the single-pane phone layout */
    main { display: none; }
    .screen.detail aside { display: none; }
    .screen.detail main { display: flex; }
    .back { display: inline-flex; align-items: center; }
    /* Header: ‹ back + title on row 1; the action bar drops to its OWN full-width row that scrolls
       horizontally (swipe) — buttons keep their natural width (flex-shrink:0) so none is ever clipped
       off-screen. */
    header { padding: 10px 12px; flex-wrap: wrap; }
    .title { flex: 1 1 auto; min-width: 0; }
    .actions { gap: 6px; flex-basis: 100%; flex-wrap: nowrap; justify-content: flex-start;
      overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
    .actions > button, .actions .seg { flex-shrink: 0; }
    .actions > button, .seg button { padding: 5px 9px; }
  }
</style>
