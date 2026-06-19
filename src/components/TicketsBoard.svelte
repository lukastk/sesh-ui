<script>
  // Tickets kanban: GET /v1/tickets/list-all → 5 status columns. Create, open a detail/editor
  // (name + prompt + status switcher + send-to-thread + unbind + delete). Moving a ticket to
  // `active` needs a bound thread, so that transition opens a thread picker (local threads).
  import { api, TICKET_STATUSES, TICKET_COLORS } from '../lib/seshClient.js'
  import { shortId } from '../lib/format.js'
  import { pushError, pushInfo } from '../lib/toasts.svelte.js'
  import { poll } from '../lib/connection.svelte.js'
  import ConfirmDialog from './ConfirmDialog.svelte'

  let entries = $state([])
  let unreachable = $state([])
  let sel = $state(null)             // open ticket (full record)
  let creating = $state(false)
  let newName = $state('')
  let bindFor = $state(null)         // {ticket, status} awaiting a thread binding
  let threadChoices = $state([])

  async function refresh() {
    // Background poll → connection store (one banner), not per-tick toasts; keep last entries.
    try {
      const r = await poll(api.ticketsAll())
      entries = r.tickets || []
      unreachable = r.unreachable || []
      // Reflect EXTERNAL status/binding changes in an open ticket, but NEVER overwrite the fields
      // the user may be editing in the dialog (name/prompt) — a blanket {...sel, ...e.ticket} merge
      // on the 3s poll clobbered in-progress edits before they could be saved.
      if (sel) {
        const e = entries.find((x) => x.ticket.id === sel.id)
        if (e) sel = { ...sel, status: e.ticket.status, thread_id: e.ticket.thread_id }
      }
    } catch {}
  }
  $effect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) })

  const byStatus = (s) => entries.filter((e) => e.ticket.status === s)

  async function setStatus(ticket, status) {
    // `active` requires a bound thread — open the picker if there isn't one yet.
    if (status === 'active' && !ticket.thread_id) {
      try { threadChoices = (await api.grid()).rows || [] } catch (e) { pushError(e); return }
      bindFor = { ticket, status }
      return
    }
    try { await api.ticketSetStatus(ticket.id, status, ticket.thread_id); await refresh() }
    catch (e) { pushError(`set-status ${status}: ${e.message ?? e}`) }
  }
  async function bindTo(threadId) {
    const { ticket } = bindFor
    bindFor = null
    try { await api.ticketSetStatus(ticket.id, 'active', threadId); await refresh() }
    catch (e) { pushError(`bind: ${e.message ?? e}`) }
  }

  async function create() {
    if (!newName.trim()) return
    try { await api.ticketCreate(newName.trim(), ''); newName = ''; creating = false; await refresh() }
    catch (e) { pushError(e) }
  }
  async function open(entry) {
    try { sel = (await api.ticketGet(entry.ticket.id)).ticket } catch (e) { pushError(e) }
  }
  async function savePrompt() {
    try { await api.ticketSet(sel.id, { prompt: sel.prompt }); pushInfo('Prompt saved'); await refresh() }
    catch (e) { pushError(e) }
  }
  async function saveName() {
    try { await api.ticketSet(sel.id, { name: sel.name }) } catch (e) { pushError(e) }
  }
  async function sendPrompt() {
    try { await api.ticketSendPrompt(sel.id); pushInfo('Prompt sent to bound thread') } catch (e) { pushError(e) }
  }
  async function unbind() {
    try { await api.ticketUnbind(sel.id); await refresh(); sel = entries.find((e) => e.ticket.id === sel.id)?.ticket ?? sel }
    catch (e) { pushError(e) }
  }
  let confirmDel = $state(false)
  async function del() {
    confirmDel = false
    try { await api.ticketDelete(sel.id); sel = null; await refresh() } catch (e) { pushError(e) }
  }
</script>

<div class="board-wrap">
  <div class="topbar">
    <span class="h">Tickets</span>
    {#if creating}
      <input bind:value={newName} placeholder="ticket name" onkeydown={(e) => e.key === 'Enter' && create()} />
      <button class="primary" onclick={create}>Create</button>
      <button onclick={() => (creating = false)}>Cancel</button>
    {:else}
      <button class="primary" onclick={() => (creating = true)}>+ New ticket</button>
    {/if}
    <div class="spacer"></div>
    {#if unreachable.length}<span class="warn">⚠ unreachable: {unreachable.join(', ')}</span>{/if}
  </div>

  <div class="board">
    {#each TICKET_STATUSES as s}
      <div class="col">
        <div class="col-head" style="color:{TICKET_COLORS[s]}">{s} <span>{byStatus(s).length}</span></div>
        <div class="cards">
          {#each byStatus(s) as e (e.ticket.id)}
            <button class="card" onclick={() => open(e)} style="border-left-color:{TICKET_COLORS[s]}">
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

  {#if sel}
    <div class="backdrop" onclick={() => (sel = null)} role="presentation">
      <div class="detail" onclick={(e) => e.stopPropagation()} role="dialog">
        <div class="d-head">
          <input class="d-name" bind:value={sel.name} onblur={saveName} />
          <span class="pill" style="background:{TICKET_COLORS[sel.status]}">{sel.status}</span>
        </div>
        <div class="status-row">
          {#each TICKET_STATUSES as s}
            <button class:on={sel.status === s} onclick={() => setStatus(sel, s)}>{s}</button>
          {/each}
        </div>
        <label>Prompt</label>
        <textarea bind:value={sel.prompt} onblur={savePrompt} placeholder="ticket prompt…"></textarea>
        <div class="d-meta">
          id {shortId(sel.id)} · created {new Date(sel.created_at_unix * 1000).toLocaleString()}
          {#if sel.thread_id}· bound {shortId(sel.thread_id)}{:else}· unbound{/if}
        </div>
        <div class="d-actions">
          <button onclick={sendPrompt} disabled={!sel.thread_id}>Send to thread</button>
          {#if sel.thread_id}<button onclick={unbind}>Unbind</button>{/if}
          <div class="spacer"></div>
          <button class="danger" onclick={() => (confirmDel = true)}>Delete</button>
          <button onclick={() => (sel = null)}>Close</button>
        </div>
      </div>
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
        <div class="d-actions"><button onclick={() => (bindFor = null)}>Cancel</button></div>
      </div>
    </div>
  {/if}

  {#if confirmDel}
    <ConfirmDialog title="Delete ticket?" danger confirmLabel="Delete"
      message={`"${sel?.name || 'this ticket'}" will be removed.`}
      onconfirm={del} oncancel={() => (confirmDel = false)} />
  {/if}
</div>

<style>
  .board-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .topbar { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #1f2030; background: #0e0f17; }
  .topbar .h { font-size: 16px; font-weight: 600; }
  .topbar .spacer { flex: 1; }
  .topbar input { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px; padding: 6px 9px; font-size: 13px; }
  .topbar button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
  .topbar .primary { background: #7aa2f7; color: #11121a; border: 0; font-weight: 600; }
  .topbar .warn { color: #e0af68; font-size: 11px; }
  .board { flex: 1; display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; padding: 14px; overflow: auto; min-height: 0; }
  .col { background: #0e0f17; border: 1px solid #1f2030; border-radius: 10px; display: flex; flex-direction: column; min-height: 0; }
  .col-head { padding: 10px 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; display: flex; justify-content: space-between; }
  .col-head span { color: #565f89; }
  .cards { flex: 1; overflow-y: auto; padding: 0 8px 8px; display: flex; flex-direction: column; gap: 7px; }
  .card { text-align: left; background: #16161e; border: 1px solid #232433; border-left: 3px solid; border-radius: 8px; padding: 9px 11px; cursor: pointer; color: inherit; }
  .card:hover { background: #1c1d2b; }
  .cname { font-size: 13px; font-weight: 500; }
  .cmeta { display: flex; gap: 8px; margin-top: 5px; font-size: 10px; color: #565f89; flex-wrap: wrap; }
  .cmeta .thread { color: #7aa2f7; }
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .detail, .binder { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 18px 20px; width: 540px; max-width: 92vw; display: flex; flex-direction: column; gap: 10px; }
  .d-head { display: flex; align-items: center; gap: 10px; }
  .d-name { flex: 1; background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 8px; font-size: 15px; font-weight: 600; }
  .pill { color: #11121a; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 20px; text-transform: uppercase; }
  .status-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .status-row button { background: #1a1b26; color: #9aa5ce; border: 1px solid #2a2b3d; border-radius: 6px; padding: 5px 11px; font-size: 12px; cursor: pointer; }
  .status-row button.on { background: #2a2b3d; color: #fff; }
  label { font-size: 11px; color: #565f89; }
  textarea { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 8px; padding: 10px; min-height: 130px; font-family: ui-monospace, monospace; font-size: 13px; resize: vertical; }
  .d-meta { font-size: 11px; color: #565f89; }
  .d-actions { display: flex; gap: 8px; align-items: center; }
  .d-actions .spacer { flex: 1; }
  .d-actions button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
  .d-actions .danger { color: #ffb4c0; border-color: #5a2030; }
  .d-actions button:disabled { opacity: 0.4; }
  .binder h3 { margin: 0; font-size: 15px; }
  .tlist { max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; border: 1px solid #1f2030; border-radius: 8px; padding: 6px; }
  .trow { display: flex; align-items: center; gap: 8px; text-align: left; background: none; border: 0; color: #c0caf5; padding: 7px 9px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .trow:hover { background: #1c1d2b; }
  .tg { color: #565f89; }
  .tn { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tk { font-size: 10px; color: #565f89; }
  .empty { color: #565f89; padding: 10px; font-size: 12px; }
</style>
