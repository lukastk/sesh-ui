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

  let { threadId } = $props()

  let history = $state([])     // completed turns from the transcript (authoritative) {role,text,thinking}
  let live = $state([])        // in-flight UI-turn overlay: user + streaming assistant + tool bubbles
  let draft = $state('')
  let state = $state('connecting…')
  let streaming = $state(false)
  let ws = null
  let scroller
  let activeFor = null
  let streamIdx = null         // index into `live` of the assistant bubble being streamed
  let pollTimer = null

  let bubbles = $derived([...history, ...live])

  async function loadHistory() {
    try {
      const t = await api.transcript(threadId, 300)
      history = parseTranscript(t.lines || [], 'pi')
      await scrollDown()
    } catch (e) {
      // A never-run pi thread has no transcript yet — a legitimate empty state, not a failure.
      if (/no transcript/i.test(String(e))) history = []
      // else: keep the last-known history; the ribbon reflects the socket/connection state.
    }
  }

  function open(id) {
    ws = new WebSocket(api.rpcURL(id))
    // Reflect the true socket state: pi only emits a state event around a turn, so without this
    // the ribbon would sit at "connecting…" even once the socket is open and ready.
    ws.onopen = () => { if (state === 'connecting…') state = 'connected' }
    ws.onmessage = async (ev) => {
      let m
      try { m = JSON.parse(ev.data) } catch { return }
      if (m.ok && m.state) { state = m.state.idle ? `idle · ${m.state.config?.model ?? 'pi'}` : 'busy'; return }
      if (m.error) { live = [...live, { role: 'tool', text: '⚠ ' + m.error }]; return }
      if (m.event === 'text_delta') {
        if (streamIdx === null) { live = [...live, { role: 'assistant', text: '' }]; streamIdx = live.length - 1; streaming = true }
        live = live.map((x, i) => (i === streamIdx ? { ...x, text: x.text + m.delta } : x))
        await scrollDown()
      } else if (m.event === 'tool_execution_start') {
        streamIdx = null; live = [...live, { role: 'tool', text: '▶ ' + m.toolName }]
      } else if (m.event === 'tool_execution_end') {
        streamIdx = null; live = [...live, { role: 'tool', text: '■ ' + m.toolName }]
      } else if (m.event === 'agent_end') {
        streamIdx = null; streaming = false; state = 'idle'
        // The completed turn is now persisted — reload the transcript, THEN drop the overlay
        // (load-then-clear, so there's no blank flash and no duplicated bubble).
        await loadHistory()
        live = []
      }
    }
    ws.onclose = () => { if (state !== 'error') state = 'closed' }
    ws.onerror = () => (state = 'error — not a live pi rpc thread?')
  }
  async function scrollDown() { await tick(); scroller?.scrollTo(0, scroller.scrollHeight) }

  function send() {
    const text = draft.trim()
    if (!text || !ws || ws.readyState !== 1) return
    live = [...live, { role: 'user', text }]
    draft = ''
    streamIdx = null
    ws.send(JSON.stringify({ message: text }))
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
    history = []; live = []; streamIdx = null; streaming = false; state = 'connecting…'
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
  <div class="log" bind:this={scroller}>
    {#each bubbles as m, i (i)}
      <div class="bubble {m.role}">
        {#if m.thinking}<div class="thinking">{m.thinking}</div>{/if}
        <div class="text">{m.text}{#if m.role === 'assistant' && streaming && i === bubbles.length - 1}<span class="cursor"></span>{/if}</div>
      </div>
    {/each}
    {#if bubbles.length === 0}<div class="empty">No turns yet — send a message (streams live), or type in the pi TUI.</div>{/if}
  </div>
  <div class="composer">
    <textarea bind:value={draft} rows="1" placeholder="Message the pi agent (streams over RPC) — Enter to send, Shift+Enter for newline" onkeydown={onkey}></textarea>
    <button onclick={send}>Send</button>
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .ribbon { padding: 5px 14px; font-size: 11px; color: #e0af68; background: #16161e;
    border-bottom: 1px solid #1f2030; font-family: ui-monospace, monospace; flex-shrink: 0; }
  .log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 9px; }
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
