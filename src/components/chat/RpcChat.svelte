<script>
  // Streaming bubble chat for a pi thread over the daemon WebSocket GET /v1/threads/rpc?id=.
  //
  // The rpc-socket only broadcasts events for turns INITIATED VIA THE SOCKET (sesh exp 04
  // FINDINGS) and carries NO history — so the socket alone misses turns typed in the pi TUI and
  // loses everything on a thread switch. We therefore back the chat with the TRANSCRIPT (the
  // source of truth for every completed turn, incl. TUI-typed ones): load it on open and poll
  // it for new turns. The socket is used only to OVERLAY the in-flight UI turn with live
  // token-level streaming. Display = transcript history + the live overlay; the overlay is
  // cleared once its completed turn lands in the reloaded transcript, so nothing shows twice.
  import { onDestroy, tick } from 'svelte'
  import { api } from '../../lib/seshClient.js'
  import { parseTranscript } from '../../lib/transcript.js'

  let { threadId, machine = undefined } = $props()  // machine: dial a remote thread's owning daemon

  let history = $state([])     // completed turns from the transcript (authoritative) {role,text,thinking}
  let live = $state([])        // in-flight UI-turn overlay: user + streaming assistant + tool bubbles
  let draft = $state('')
  let state = $state('connecting…')
  let streaming = $state(false) // a UI turn is in flight (send → agent_end): freezes the history poll
  let atBottom = $state(true)   // is the log scrolled to the bottom? (drives auto-follow + jump button)
  let ws = null
  let scroller
  let activeFor = null
  let streamIdx = null         // index into `live` of the assistant bubble being streamed
  let pollTimer = null

  // Stable keys so the optimistic `live` bubbles are SWAPPED for the reloaded `history` ones (never
  // shown alongside): history is append-only so its index is stable; live is a separate keyspace.
  let bubbles = $derived([
    ...history.map((m, i) => ({ ...m, key: 'h' + i })),
    ...live.map((m, i) => ({ ...m, key: 'l' + i })),
  ])

  // force=true only on the agent_end reload: a background poll that resolves DURING a UI turn must
  // NOT apply (it could pick up the just-sent user message into `history` while the optimistic copy
  // still sits in `live` → a transient duplicate). Freezing history during the turn prevents that.
  async function loadHistory(force = false) {
    try {
      const t = await api.transcript(threadId, 300, machine)
      if (!force && streaming) return
      history = parseTranscript(t.lines || [], 'pi')
      await scrollDown()
    } catch (e) {
      // A never-run pi thread has no transcript yet — a legitimate empty state, not a failure.
      if (/no transcript/i.test(String(e))) history = []
      // else: keep the last-known history; the ribbon reflects the socket/connection state.
    }
  }

  function open(id) {
    ws = new WebSocket(api.rpcURL(id, machine))
    // Reflect the true socket state: pi only emits a state event around a turn, so without this
    // the ribbon would sit at "connecting…" even once the socket is open and ready.
    ws.onopen = () => { if (state === 'connecting…') state = 'connected' }
    ws.onmessage = async (ev) => {
      let m
      try { m = JSON.parse(ev.data) } catch { return }
      if (m.ok && m.state) { state = m.state.idle ? `idle · ${m.state.config?.model ?? 'pi'}` : 'busy'; return }
      if (m.error) { live = [...live, { role: 'tool', text: '⚠ ' + m.error }]; return }
      if (m.event === 'text_delta') {
        if (streamIdx === null) { live = [...live, { role: 'assistant', text: '' }]; streamIdx = live.length - 1 }
        live = live.map((x, i) => (i === streamIdx ? { ...x, text: x.text + m.delta } : x))
        await scrollDown()
      } else if (m.event === 'tool_execution_start') {
        streamIdx = null; live = [...live, { role: 'tool', text: '▶ ' + m.toolName }]
      } else if (m.event === 'tool_execution_end') {
        streamIdx = null; live = [...live, { role: 'tool', text: '■ ' + m.toolName }]
      } else if (m.event === 'agent_end') {
        streamIdx = null; state = 'idle'
        // The completed turn is now persisted — reload the transcript (forced), THEN drop the overlay
        // and unfreeze the poll, so the turn is shown exactly once (history) with no blank flash.
        await loadHistory(true)
        live = []; streaming = false
      }
    }
    // On close/error end any in-flight turn so the history poll resumes (never stay frozen).
    ws.onclose = () => { streaming = false; if (state !== 'error') state = 'closed' }
    ws.onerror = () => { streaming = false; state = 'error — not a live pi rpc thread?' }
  }
  function onScroll() {
    if (!scroller) return
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48
  }
  async function scrollDown(force = false) {
    if (!force && !atBottom) return   // user scrolled up — don't yank them back down
    await tick()
    scroller?.scrollTo(0, scroller.scrollHeight)
    atBottom = true
  }

  function send() {
    const text = draft.trim()
    if (!text || !ws || ws.readyState !== 1) return
    streaming = true              // freeze the history poll for the whole turn (closes the dup window)
    live = [...live, { role: 'user', text }]
    draft = ''
    streamIdx = null
    ws.send(JSON.stringify({ message: text }))
    scrollDown(true)              // sending always snaps to the latest
  }
  function onkey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // (Re)bind per thread. The parent re-polls the grid (reassigning the selected row), so guard
  // against re-runs for the SAME id that would wipe state and leak sockets/timers.
  $effect(() => {
    const id = threadId
    if (id === activeFor) return
    activeFor = id
    history = []; live = []; streamIdx = null; streaming = false; state = 'connecting…'; atBottom = true
    try { ws?.close() } catch {}
    clearInterval(pollTimer)
    loadHistory()                 // show persisted history immediately — never blank on switch
    open(id)                      // socket: live streaming of UI-initiated turns
    // Poll the transcript so TUI-initiated turns (never broadcast on the socket) appear too.
    // Skip while a UI turn is mid-stream (the overlay is showing it; reload happens on agent_end).
    pollTimer = setInterval(() => { if (!streaming) loadHistory() }, 2000)
  })
  onDestroy(() => { try { ws?.close() } catch {}; clearInterval(pollTimer) })
</script>

<div class="chat">
  <div class="ribbon">⚡ pi RPC · transcript-backed · {state}</div>
  <div class="log" bind:this={scroller} onscroll={onScroll}>
    {#each bubbles as m, i (m.key)}
      <div class="bubble {m.role}">
        {#if m.thinking}<div class="thinking">{m.thinking}</div>{/if}
        <div class="text">{m.text}{#if m.role === 'assistant' && streaming && i === bubbles.length - 1}<span class="cursor"></span>{/if}</div>
      </div>
    {/each}
    {#if bubbles.length === 0}<div class="empty">No turns yet — send a message (streams live), or type in the pi TUI.</div>{/if}
  </div>
  {#if !atBottom}
    <button class="jump" onclick={() => scrollDown(true)} title="jump to latest">↓ latest</button>
  {/if}
  <div class="composer">
    <textarea bind:value={draft} rows="1" placeholder="Message the pi agent (streams over RPC) — Enter to send, Shift+Enter for newline" onkeydown={onkey}></textarea>
    <button onclick={send}>Send</button>
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative; }
  .ribbon { padding: 5px 14px; font-size: 11px; color: #e0af68; background: #16161e;
    border-bottom: 1px solid #1f2030; font-family: ui-monospace, monospace; flex-shrink: 0; }
  /* own our overflow: a wheel at the top/bottom edge must NOT bubble out to the page/sidebar. */
  .log { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 14px;
    display: flex; flex-direction: column; gap: 9px; }
  .jump { position: absolute; bottom: 70px; left: 50%; transform: translateX(-50%); z-index: 5;
    background: #7aa2f7; color: #11121a; border: 0; border-radius: 16px; padding: 5px 13px;
    font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: 0 3px 12px rgba(0,0,0,0.5); }
  .bubble { max-width: 80%; padding: 8px 12px; border-radius: 10px; white-space: pre-wrap;
    font-size: 14px; line-height: 1.5; word-break: break-word; }
  .user { align-self: flex-end; background: #3d59a1; color: #fff; }
  .assistant { align-self: flex-start; background: #1c1d2b; color: #c0caf5; }
  .tool { align-self: flex-start; font-size: 11px; color: #e0af68; font-family: ui-monospace, monospace;
    background: none; padding: 0 4px; }
  .thinking { opacity: 0.5; font-style: italic; font-size: 12px; margin-bottom: 6px;
    border-left: 2px solid #565f89; padding-left: 6px; }
  .empty { color: #565f89; font-size: 13px; margin: auto; }
  .cursor::after { content: '▋'; color: #7aa2f7; animation: blink 1s steps(2) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #1f2030;
    background: #16161e; flex-shrink: 0; }
  textarea { flex: 1; resize: none; background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d;
    border-radius: 8px; padding: 9px; font-size: 14px; font-family: inherit; line-height: 1.4; max-height: 140px; }
  button { background: #e0af68; color: #16161e; border: 0; border-radius: 8px; padding: 0 16px;
    font-weight: 600; cursor: pointer; }
</style>
