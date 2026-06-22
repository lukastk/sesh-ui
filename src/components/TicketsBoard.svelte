<script>
  // Tickets screen. Two views over GET /v1/tickets/list-all:
  //   • LIST (default) — a Threads-style list+detail: a left sidebar (fzf filter by name [default]
  //     and/or prompt, plus a status filter) and a right editor for ALL of a ticket's properties.
  //   • BOARD — the 5-status kanban (kept, but no longer the default).
  // Create is a modal (name + prompt + status). Shortcuts: cmd+n new ticket, cmd+f focus the filter.
  // Both views share the same editor (a {#snippet}) and the same set of dialogs (bind/move/delete).
  import { tick } from 'svelte'
  import { api, TICKET_STATUSES, TICKET_COLORS } from '../lib/seshClient.js'
  import { shortId } from '../lib/format.js'
  import { fuzzyScore } from '../lib/fuzzy.js'
  import { matchAction } from '../lib/keymap.svelte.js'
  import { pushError, pushInfo } from '../lib/toasts.svelte.js'
  import { poll } from '../lib/connection.svelte.js'
  import { copyText } from '../lib/clipboard.js'
  import { cacheSet, cacheGet } from '../lib/snapshot.svelte.js'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import ContextMenu from './ContextMenu.svelte'
  import { longpress } from '../lib/longpress.js'
  import { dragscrollx } from '../lib/dragscrollx.js'
  import { registerBack } from '../lib/back.js'

  // Seed from the offline cache (Android) so a cold offline start shows the last-known tickets.
  let entries = $state(cacheGet('tickets')?.data || [])
  let unreachable = $state([])
  let sel = $state(null)             // open ticket (full record, from ticketGet)
  let selMachine = $state(null)      // the open ticket's owning machine (for set/move/etc.)
  let bindFor = $state(null)         // {ticket, status} awaiting a thread binding
  let threadChoices = $state([])
  let findId = $state('')            // deep-link: find a ticket by id across the mesh
  let moveFor = $state(null)         // {id, from} awaiting a target machine
  let machineChoices = $state([])

  // View: list (default) | board. Persisted locally.
  let view = $state((() => { try { return localStorage.getItem('seshui.ticketsView') || 'list' } catch { return 'list' } })())
  function setView(v) { view = v; try { localStorage.setItem('seshui.ticketsView', v) } catch {} }

  // Create modal.
  let creating = $state(false)
  let newName = $state('')
  let newPrompt = $state('')
  let newNameEl = $state(null)

  // ── list filter (fzf) ──────────────────────────────────────────────────────
  let filter = $state('')
  let filterEl = $state(null)
  let fName = $state(true)            // match the name (default on)
  let fPrompt = $state(false)         // match the prompt
  let statusFilter = $state('all')    // 'all' | one of TICKET_STATUSES
  let filterActive = $state(0)        // fzf highlighted candidate index
  let listEl = $state(null)

  // sidebar width (drag-resizable, like Threads), persisted.
  let sidebarWidth = $state((() => { const v = Number(localStorage.getItem('seshui.ticketsSidebarW')); return v >= 220 && v <= 640 ? v : 340 })())
  let resizing = $state(false)
  function startResize(e) {
    e.preventDefault(); resizing = true
    const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--font-scale')) || 1
    const onMove = (ev) => { sidebarWidth = Math.min(640, Math.max(220, Math.round(ev.clientX / scale))) }
    const onUp = () => {
      resizing = false
      try { localStorage.setItem('seshui.ticketsSidebarW', String(sidebarWidth)) } catch {}
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  async function refresh() {
    try {
      const r = await poll(api.ticketsAll())
      entries = r.tickets || []
      unreachable = r.unreachable || []
      cacheSet('tickets', entries)
      // Reflect EXTERNAL status/binding changes in the open ticket, but NEVER clobber the fields the
      // user may be editing (name/prompt/notes) — only status + thread_id are merged.
      if (sel) {
        const e = entries.find((x) => x.ticket.id === sel.id)
        if (e) sel = { ...sel, status: e.ticket.status, thread_id: e.ticket.thread_id }
      }
    } catch {}
  }
  $effect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) })

  const byStatus = (s) => entries.filter((e) => e.ticket.status === s)

  // The fzf-ranked sidebar list: status filter, then fuzzy match over the enabled fields.
  let searchFields = $derived(fName || fPrompt ? { name: fName, prompt: fPrompt } : { name: true })
  let listed = $derived.by(() => {
    const q = filter.trim()
    let es = entries
    if (statusFilter !== 'all') es = es.filter((e) => e.ticket.status === statusFilter)
    if (!q) return [...es].sort((a, b) => (a.ticket.name || '').localeCompare(b.ticket.name || ''))
    return es
      .map((e) => {
        const hay = [searchFields.name && e.ticket.name, searchFields.prompt && e.ticket.prompt].filter(Boolean).join(' ')
        return { e, s: fuzzyScore(q, hay) }
      })
      .filter((x) => x.s !== null)
      .sort((a, b) => a.s - b.s || (a.e.ticket.name || '').localeCompare(b.e.ticket.name || ''))
      .map((x) => x.e)
  })
  let activeIdx = $derived(Math.min(filterActive, Math.max(0, listed.length - 1)))
  $effect(() => { void filter; void statusFilter; filterActive = 0 })
  $effect(() => { void activeIdx; if (filter.trim()) listEl?.querySelector('.t-row.fzactive')?.scrollIntoView({ block: 'nearest' }) })

  function onFilterKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); filterActive = Math.min(activeIdx + 1, listed.length - 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); filterActive = Math.max(activeIdx - 1, 0) }
    else if (e.key === 'Enter') { e.preventDefault(); const e2 = listed[activeIdx]; if (e2) open(e2) }
    else if (e.key === 'Escape') { e.preventDefault(); filter = '' }
  }

  // ── actions ─────────────────────────────────────────────────────────────────
  async function setStatus(ticket, status) {
    if (status === 'active' && !ticket.thread_id) {
      try { threadChoices = (await api.grid()).rows || [] } catch (e) { pushError(e); return }
      bindFor = { ticket, status }
      return
    }
    try { await api.ticketSetStatus(ticket.id, status, ticket.thread_id, undefined, selMachine); await refresh() }
    catch (e) { pushError(`set-status ${status}: ${e.message ?? e}`) }
  }
  async function bindTo(threadId) {
    const { ticket } = bindFor
    bindFor = null
    try { await api.ticketSetStatus(ticket.id, 'active', threadId, undefined, selMachine); await refresh() }
    catch (e) { pushError(`bind: ${e.message ?? e}`) }
  }

  function openCreate() { newName = ''; newPrompt = ''; creating = true }
  async function create() {
    if (!newName.trim()) return
    try {
      const r = await api.ticketCreate(newName.trim(), newPrompt)
      creating = false; newName = ''; newPrompt = ''
      await refresh()
      // Open the freshly-created ticket in the editor (the create response carries its id).
      const id = r?.ticket?.id || r?.id
      const entry = entries.find((e) => e.ticket.id === id)
      if (entry) open(entry)
    } catch (e) { pushError(e) }
  }
  async function open(entry) {
    // Route to the ticket's owning daemon (a remote ticket 404s on the connected daemon otherwise).
    try { sel = (await api.ticketGet(entry.ticket.id, entry.machine)).ticket; selMachine = entry.machine } catch (e) { pushError(e) }
  }
  function copyId(id) { copyText(id) ? pushInfo('Copied full id') : pushError('copy failed') }
  async function doFind() {
    const id = findId.trim()
    if (!id) return
    try {
      const r = await api.ticketFind(id)
      if (!r.found) { pushError(`no ticket ${id}${r.unreachable?.length ? ` (unreachable: ${r.unreachable.join(', ')})` : ''}`); return }
      sel = r.ticket; selMachine = r.machine; findId = ''
      pushInfo(`found on ${r.machine}`)
    } catch (e) { pushError(`find: ${e.message ?? e}`) }
  }
  async function openMoveFor(id, from) {
    try { machineChoices = ((await api.mesh()).machines || []).map((m) => m.machine).filter((m) => m !== from) }
    catch (e) { pushError(e); return }
    moveFor = { id, from }
  }
  const openMove = () => openMoveFor(sel.id, selMachine)
  async function moveTo(to) {
    const { id, from } = moveFor
    moveFor = null
    try { await api.ticketMove(id, to, from); pushInfo(`moved to ${to}`); sel = null; await refresh() }
    catch (e) { pushError(`move: ${e.message ?? e}`) }
  }
  async function savePrompt() {
    try { await api.ticketSet(sel.id, { prompt: sel.prompt }, selMachine); pushInfo('Prompt saved'); await refresh() }
    catch (e) { pushError(e) }
  }
  async function saveName() {
    try { await api.ticketSet(sel.id, { name: sel.name }, selMachine) } catch (e) { pushError(e) }
  }
  async function saveNotes() {
    try { await api.ticketSet(sel.id, { notes: sel.notes ?? '' }, selMachine); pushInfo('Notes saved') } catch (e) { pushError(e) }
  }
  async function sendPrompt() {
    try { await api.ticketSendPrompt(sel.id, selMachine); pushInfo('Prompt sent to bound thread') } catch (e) { pushError(e) }
  }
  async function unbind() {
    try { await api.ticketUnbind(sel.id, selMachine); await refresh(); sel = entries.find((e) => e.ticket.id === sel.id)?.ticket ?? sel }
    catch (e) { pushError(e) }
  }
  let confirmDel = $state(false)
  async function del() {
    confirmDel = false
    try { await api.ticketDelete(sel.id, selMachine); sel = null; await refresh() } catch (e) { pushError(e) }
  }

  // Right-click (desktop) / long-press (Android) → context menu of a card/row's actions, routed via
  // its owning machine (entry.machine) — no need to open the editor first.
  let ctxMenu = $state(null)
  let cardDel = $state(null)
  async function cardSetStatus(entry, status) {
    const t = entry.ticket
    if (status === 'active' && !t.thread_id) { open(entry); return }
    try { await api.ticketSetStatus(t.id, status, t.thread_id, undefined, entry.machine); await refresh() }
    catch (e) { pushError(`set-status ${status}: ${e.message ?? e}`) }
  }
  async function cardUnbind(entry) {
    try { await api.ticketUnbind(entry.ticket.id, entry.machine); await refresh() } catch (e) { pushError(e) }
  }
  async function doCardDel() {
    const entry = cardDel; cardDel = null
    try { await api.ticketDelete(entry.ticket.id, entry.machine); if (sel?.id === entry.ticket.id) sel = null; await refresh() }
    catch (e) { pushError(e) }
  }
  function cardMenuItems(entry) {
    const t = entry.ticket
    const items = [{ label: 'Open', onselect: () => open(entry) }, { separator: true }]
    for (const s of TICKET_STATUSES) if (s !== t.status) items.push({ label: `→ ${s}`, onselect: () => cardSetStatus(entry, s) })
    items.push({ separator: true }, { label: 'Move…', onselect: () => openMoveFor(t.id, entry.machine) })
    if (t.thread_id) items.push({ label: 'Unbind', onselect: () => cardUnbind(entry) })
    items.push({ separator: true }, { label: 'Delete', danger: true, onselect: () => (cardDel = entry) })
    return items
  }
  function openCardMenu(x, y, entry) { ctxMenu = { x, y, items: cardMenuItems(entry) } }

  // Tickets-scoped shortcuts (active only while this screen is mounted): cmd+n / cmd+f.
  async function onScreenKey(e) {
    if (matchAction(e, 'tickets.new')) { e.preventDefault(); openCreate() }
    else if (matchAction(e, 'tickets.focusFilter')) {
      e.preventDefault()
      if (view !== 'list') { setView('list'); await tick() }   // the filter input only mounts in list view
      filterEl?.focus(); filterEl?.select()
    }
  }
  // Auto-focus the create modal's name field when it opens.
  $effect(() => { if (creating) newNameEl?.focus() })

  // Android "back": peel off any open overlay (topmost-first) before leaving the screen.
  $effect(() => registerBack(() => {
    if (ctxMenu) { ctxMenu = null; return true }
    if (confirmDel) { confirmDel = false; return true }
    if (cardDel) { cardDel = null; return true }
    if (moveFor) { moveFor = null; return true }
    if (bindFor) { bindFor = null; return true }
    if (creating) { creating = false; return true }
    if (sel) { sel = null; return true }
    return false
  }))
</script>

<svelte:window onkeydown={onScreenKey} />

{#snippet editor()}
  <div class="ed-head">
    <input class="ed-name" bind:value={sel.name} onblur={saveName} placeholder="ticket name" />
    <span class="pill" style="background:{TICKET_COLORS[sel.status]}">{sel.status}</span>
  </div>
  <div class="status-row">
    {#each TICKET_STATUSES as s}
      <button class:on={sel.status === s} style={sel.status === s ? `background:${TICKET_COLORS[s]};color:#11121a` : ''} onclick={() => setStatus(sel, s)}>{s}</button>
    {/each}
  </div>
  <label>Prompt</label>
  <textarea class="ta-prompt" bind:value={sel.prompt} onblur={savePrompt} placeholder="ticket prompt…"></textarea>
  <label>Notes</label>
  <textarea class="ta-notes" bind:value={sel.notes} onblur={saveNotes} placeholder="(notes — appended to as agents report progress)"></textarea>
  <div class="ed-meta">
    id <button class="copyid" onclick={() => copyId(sel.id)} title={`copy full id: ${sel.id}`}>⧉ {shortId(sel.id)}</button>
    · created {new Date(sel.created_at_unix * 1000).toLocaleString()}
    {#if selMachine}· on {selMachine}{/if}
    {#if sel.thread_id}· bound {shortId(sel.thread_id)}{:else}· unbound{/if}
  </div>
  <div class="ed-actions">
    <button onclick={sendPrompt} disabled={!sel.thread_id}>Send to thread</button>
    {#if sel.thread_id}<button onclick={unbind}>Unbind</button>{/if}
    <button onclick={openMove} title="move this ticket to another machine">Move…</button>
    <div class="spacer"></div>
    <button class="danger" onclick={() => (confirmDel = true)}>Delete</button>
  </div>
{/snippet}

<div class="tickets">
  <div class="topbar">
    <span class="h">Tickets</span>
    <div class="seg view">
      <button class:on={view === 'list'} onclick={() => setView('list')}>List</button>
      <button class:on={view === 'board'} onclick={() => setView('board')}>Board</button>
    </div>
    <button class="primary" onclick={openCreate} title="new ticket (⌘N)">+ New ticket</button>
    <input class="find" bind:value={findId} placeholder="find by id…" onkeydown={(e) => e.key === 'Enter' && doFind()} />
    <div class="spacer"></div>
    {#if unreachable.length}<span class="warn">⚠ unreachable: {unreachable.join(', ')}</span>{/if}
  </div>

  {#if view === 'board'}
    <div class="board" use:dragscrollx>
      {#each TICKET_STATUSES as s}
        <div class="col">
          <div class="col-head" style="color:{TICKET_COLORS[s]}">{s} <span>{byStatus(s).length}</span></div>
          <div class="cards">
            {#each byStatus(s) as e (e.ticket.id)}
              <button class="card" onclick={() => open(e)} style="border-left-color:{TICKET_COLORS[s]}"
                oncontextmenu={(ev) => { ev.preventDefault(); openCardMenu(ev.clientX, ev.clientY, e) }}
                use:longpress={{ onlongpress: (lp) => openCardMenu(lp.x, lp.y, e) }}>
                <div class="cname">{e.ticket.name || '(unnamed)'}</div>
                <div class="cmeta">
                  <span class="machine">{e.machine}</span>
                  {#if e.thread_name}<span class="thread">▸ {e.thread_name}{e.thread_archived ? ' (archived)' : ''}</span>{/if}
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="screen" class:detail={!!sel} class:resizing style="--sidebar-w:{sidebarWidth}px">
      <aside>
        <div class="controls">
          <input class="filter" bind:this={filterEl} bind:value={filter} placeholder="filter tickets…  (⌘F)" onkeydown={onFilterKey} />
          <div class="filt-opts">
            <span class="fl-label">match</span>
            <label class="chip"><input type="checkbox" bind:checked={fName} /> name</label>
            <label class="chip"><input type="checkbox" bind:checked={fPrompt} /> prompt</label>
            <select class="status-sel" bind:value={statusFilter} title="filter by status">
              <option value="all">all status</option>
              {#each TICKET_STATUSES as s}<option value={s}>{s}</option>{/each}
            </select>
          </div>
        </div>
        <div class="list" bind:this={listEl}>
          {#each listed as e, i (e.ticket.id)}
            <button class="t-row" class:sel={sel?.id === e.ticket.id} class:fzactive={filter.trim() && i === activeIdx}
              onclick={() => open(e)} style="border-left-color:{TICKET_COLORS[e.ticket.status]}"
              oncontextmenu={(ev) => { ev.preventDefault(); openCardMenu(ev.clientX, ev.clientY, e) }}
              use:longpress={{ onlongpress: (lp) => openCardMenu(lp.x, lp.y, e) }}>
              <span class="t-status" style="color:{TICKET_COLORS[e.ticket.status]}">{e.ticket.status}</span>
              <span class="t-name">{e.ticket.name || '(unnamed)'}</span>
              <span class="t-meta">
                {#if e.machine}<span class="t-mach">{e.machine}</span>{/if}
                {#if e.thread_name}<span class="t-thread">▸ {e.thread_name}</span>{/if}
              </span>
            </button>
          {/each}
          {#if listed.length === 0}<div class="empty">{filter || statusFilter !== 'all' ? 'no matching tickets' : 'no tickets — click “+ New ticket”.'}</div>{/if}
        </div>
      </aside>

      <div class="resizer" class:active={resizing} style="left:calc(var(--sidebar-w) - 3px)"
        onpointerdown={startResize} role="separator" aria-label="resize sidebar"
        title="drag to resize · double-click to reset" ondblclick={() => { sidebarWidth = 340; try { localStorage.setItem('seshui.ticketsSidebarW', '340') } catch {} }}></div>

      <main>
        {#if !sel}
          <div class="placeholder">Select a ticket to view and edit it.</div>
        {:else}
          <button class="back" onclick={() => (sel = null)} aria-label="back to ticket list" title="back to tickets">‹ back</button>
          <div class="ed">{@render editor()}</div>
        {/if}
      </main>
    </div>
  {/if}

  {#if creating}
    <div class="backdrop" onclick={() => (creating = false)} role="presentation">
      <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
        <h3>New ticket</h3>
        <label>Name<input bind:this={newNameEl} bind:value={newName} placeholder="ticket name"
          onkeydown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create() }} /></label>
        <label>Prompt<textarea bind:value={newPrompt} placeholder="the instructions for this ticket…"></textarea></label>
        <div class="m-actions">
          <button onclick={() => (creating = false)}>Cancel</button>
          <button class="primary" onclick={create} disabled={!newName.trim()}>Create</button>
        </div>
      </div>
    </div>
  {/if}

  {#if sel && view === 'board'}
    <div class="backdrop" onclick={() => (sel = null)} role="presentation">
      <div class="detail" onclick={(e) => e.stopPropagation()} role="dialog">{@render editor()}</div>
    </div>
  {/if}

  {#if bindFor}
    <div class="backdrop" onclick={() => (bindFor = null)} role="presentation">
      <div class="binder" onclick={(e) => e.stopPropagation()} role="dialog">
        <h3>Bind “{bindFor.ticket.name || 'ticket'}” to a thread</h3>
        <div class="tlist">
          {#each threadChoices as t (t.id)}
            <button class="trow" onclick={() => bindTo(t.id)}>
              <span class="tg">{t.head === 'headful' ? '●' : '◌'}</span>
              <span class="tn">{t.name || '(nameless)'}</span>
              <span class="tk">{t.agent_kind}</span>
            </button>
          {/each}
          {#if threadChoices.length === 0}<div class="empty">no threads to bind to</div>{/if}
        </div>
        <div class="ed-actions"><button onclick={() => (bindFor = null)}>Cancel</button></div>
      </div>
    </div>
  {/if}

  {#if moveFor}
    <div class="backdrop" onclick={() => (moveFor = null)} role="presentation">
      <div class="binder" onclick={(e) => e.stopPropagation()} role="dialog">
        <h3>Move ticket to a machine</h3>
        <div class="tlist">
          {#each machineChoices as m (m)}
            <button class="trow" onclick={() => moveTo(m)}><span class="tn">{m}</span></button>
          {/each}
          {#if machineChoices.length === 0}<div class="empty">no other machine in the mesh</div>{/if}
        </div>
        <div class="ed-actions"><button onclick={() => (moveFor = null)}>Cancel</button></div>
      </div>
    </div>
  {/if}

  {#if confirmDel}
    <ConfirmDialog title="Delete ticket?" danger confirmLabel="Delete"
      message={`"${sel?.name || 'this ticket'}" will be removed.`}
      onconfirm={del} oncancel={() => (confirmDel = false)} />
  {/if}

  {#if cardDel}
    <ConfirmDialog title="Delete ticket?" danger confirmLabel="Delete"
      message={`"${cardDel.ticket.name || 'this ticket'}" will be removed.`}
      onconfirm={doCardDel} oncancel={() => (cardDel = null)} />
  {/if}

  {#if ctxMenu}
    <ContextMenu items={ctxMenu.items} x={ctxMenu.x} y={ctxMenu.y} onclose={() => (ctxMenu = null)} />
  {/if}
</div>

<style>
  .tickets { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .topbar { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #1f2030; background: #0e0f17; }
  .topbar .h { font-size: 16px; font-weight: 600; }
  .topbar .spacer { flex: 1; }
  .topbar input { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px; padding: 6px 9px; font-size: 13px; }
  .topbar > button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
  .topbar .primary { background: #7aa2f7; color: #11121a; border: 0; font-weight: 600; }
  .topbar .warn { color: #e0af68; font-size: 11px; }
  .seg { display: flex; border: 1px solid #2a2b3d; border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; border-radius: 0; background: #1a1b26; color: #9aa5ce; padding: 5px 12px; font-size: 12px; cursor: pointer; }
  .seg button.on { background: #2a2b3d; color: #fff; font-weight: 600; }

  /* ── list+detail view (mirrors ThreadsScreen) ── */
  .screen { position: relative; flex: 1; display: grid; grid-template-columns: var(--sidebar-w, 340px) 1fr; min-height: 0; }
  .screen.resizing { cursor: col-resize; user-select: none; }
  .resizer { position: absolute; top: 0; bottom: 0; width: 7px; z-index: 8; cursor: col-resize; }
  .resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: transparent; }
  .resizer:hover::after, .resizer.active::after { background: #7aa2f7; box-shadow: 0 0 5px #7aa2f788; }
  aside { background: #0e0f17; border-right: 1px solid #1f2030; display: flex; flex-direction: column; min-height: 0; }
  .controls { display: flex; flex-direction: column; gap: 7px; padding: 10px 12px; border-bottom: 1px solid #1f2030; }
  .filter { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px; padding: 6px 9px; font-size: 12px; }
  .filt-opts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .fl-label { font-size: 10px; color: #565f89; text-transform: uppercase; letter-spacing: 0.05em; }
  .chip { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #9aa5ce; cursor: pointer; }
  .status-sel { margin-left: auto; background: #1a1b26; color: #9aa5ce; border: 1px solid #2a2b3d; border-radius: 6px; padding: 3px 6px; font-size: 11px; }
  .list { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
  .t-row { text-align: left; background: #16161e; border: 1px solid #232433; border-left: 3px solid; border-radius: 8px;
    padding: 8px 10px; cursor: pointer; color: inherit; display: flex; flex-direction: column; gap: 3px; }
  .t-row:hover { background: #1c1d2b; }
  .t-row.fzactive { box-shadow: inset 0 0 0 1px #7dcfff; }
  .t-row.sel { background: #181a26; border-color: #2a3a5a; }
  .t-status { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
  .t-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-meta { display: flex; gap: 8px; font-size: 10px; color: #565f89; flex-wrap: wrap; }
  .t-meta .t-thread { color: #7aa2f7; }
  .empty, .placeholder { color: #565f89; padding: 20px; font-size: 13px; }
  main { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow-y: auto; }
  .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; }
  .back { display: none; }
  .ed { display: flex; flex-direction: column; gap: 10px; padding: 18px 20px; max-width: 760px; width: 100%; }
  .ed-head { display: flex; align-items: center; gap: 10px; }
  .ed-name { flex: 1; background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 9px; font-size: 16px; font-weight: 600; }
  .pill { color: #11121a; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 20px; text-transform: uppercase; }
  .status-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .status-row button { background: #1a1b26; color: #9aa5ce; border: 1px solid #2a2b3d; border-radius: 6px; padding: 5px 11px; font-size: 12px; cursor: pointer; }
  .status-row button.on { font-weight: 700; border-color: transparent; }
  label { font-size: 11px; color: #565f89; }
  textarea { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 8px; padding: 10px;
    font-family: ui-monospace, monospace; font-size: 13px; resize: vertical; }
  .ta-prompt { min-height: 150px; } .ta-notes { min-height: 90px; }
  .ed-meta { font-size: 11px; color: #565f89; }
  .copyid { background: #1a1b26; color: #7dcfff; border: 1px solid #2a2b3d; border-radius: 5px;
    padding: 0 6px; font-size: 10px; font-family: ui-monospace, monospace; cursor: pointer; }
  .copyid:hover { background: #232433; }
  .ed-actions { display: flex; gap: 8px; align-items: center; }
  .ed-actions .spacer { flex: 1; }
  .ed-actions button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
  .ed-actions .danger { color: #ffb4c0; border-color: #5a2030; }
  .ed-actions button:disabled { opacity: 0.4; }

  /* ── board (kanban) view ── */
  .board { flex: 1; display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; padding: 14px; overflow: auto; overscroll-behavior: contain; min-height: 0; }
  .col { background: #0e0f17; border: 1px solid #1f2030; border-radius: 10px; display: flex; flex-direction: column; min-height: 0; }
  .col-head { padding: 10px 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; display: flex; justify-content: space-between; }
  .col-head span { color: #565f89; }
  .cards { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 0 8px 8px; display: flex; flex-direction: column; gap: 7px; }
  .card { text-align: left; background: #16161e; border: 1px solid #232433; border-left: 3px solid; border-radius: 8px; padding: 9px 11px; cursor: pointer; color: inherit; }
  .card:hover { background: #1c1d2b; }
  .cname { font-size: 13px; font-weight: 500; }
  .cmeta { display: flex; gap: 8px; margin-top: 5px; font-size: 10px; color: #565f89; flex-wrap: wrap; }
  .cmeta .thread { color: #7aa2f7; }

  /* ── shared dialogs ── */
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .modal, .detail, .binder { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 18px 20px; width: 540px; max-width: 92vw; display: flex; flex-direction: column; gap: 10px; max-height: 88vh; overflow-y: auto; }
  .modal h3, .binder h3 { margin: 0; font-size: 15px; }
  .modal label { display: flex; flex-direction: column; gap: 5px; color: #9aa5ce; }
  .modal input { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 8px; font-size: 14px; }
  .modal textarea { min-height: 120px; }
  .m-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .m-actions button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 7px 16px; cursor: pointer; font-size: 13px; }
  .m-actions .primary { background: #7aa2f7; color: #11121a; border: 0; font-weight: 600; }
  .m-actions button:disabled { opacity: 0.5; }
  .tlist { max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; border: 1px solid #1f2030; border-radius: 8px; padding: 6px; }
  .trow { display: flex; align-items: center; gap: 8px; text-align: left; background: none; border: 0; color: #c0caf5; padding: 7px 9px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .trow:hover { background: #1c1d2b; }
  .tg { color: #565f89; }
  .tn { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tk { font-size: 10px; color: #565f89; }

  /* Phone width: single pane (list OR editor, with a back button), and the board swipes column-wise. */
  @media (max-width: 720px) {
    .screen { grid-template-columns: 1fr; }
    .resizer { display: none; }
    main { display: none; }
    .screen.detail aside { display: none; }
    .screen.detail main { display: flex; }
    .back { display: inline-flex; align-items: center; align-self: flex-start; margin: 10px 0 0 12px;
      background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px; font-size: 13px; padding: 4px 11px; cursor: pointer; }
    .board { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 82vw; overflow-x: auto; padding: 12px; }
    .topbar input.find { min-width: 0; flex: 1; }
  }
</style>
