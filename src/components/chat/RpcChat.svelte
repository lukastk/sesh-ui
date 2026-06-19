<script>
  // Streaming bubble chat for a pi thread over the daemon WebSocket GET /v1/threads/rpc?id=.
  // Works for headful AND headless pi (token-level streaming — pi-only by construction).
  // The socket URL comes from seshClient (the proxy/main-process injects the bearer token).
  import { onDestroy, tick } from 'svelte'
  import { api } from '../../lib/seshClient.js'

  let { threadId } = $props()

  let msgs = $state([])        // {role:'user'|'assistant'|'tool', text}
  let draft = $state('')
  let state = $state('connecting…')
  let streaming = $state(false)
  let ws = null
  let scroller
  let connectedFor = null
  let streamIdx = null

  function open(id) {
    ws = new WebSocket(api.rpcURL(id))
    ws.onmessage = async (ev) => {
      let m
      try { m = JSON.parse(ev.data) } catch { return }
      if (m.ok && m.state) { state = m.state.idle ? `idle · ${m.state.config?.model ?? 'pi'}` : 'busy'; return }
      if (m.error) { msgs = [...msgs, { role: 'tool', text: '⚠ ' + m.error }]; return }
      if (m.event === 'text_delta') {
        if (streamIdx === null) { msgs = [...msgs, { role: 'assistant', text: '' }]; streamIdx = msgs.length - 1; streaming = true }
        msgs = msgs.map((x, i) => (i === streamIdx ? { ...x, text: x.text + m.delta } : x))
        await scrollDown()
      } else if (m.event === 'tool_execution_start') {
        streamIdx = null; msgs = [...msgs, { role: 'tool', text: '▶ ' + m.toolName }]
      } else if (m.event === 'tool_execution_end') {
        streamIdx = null; msgs = [...msgs, { role: 'tool', text: '■ ' + m.toolName }]
      } else if (m.event === 'agent_end') {
        streamIdx = null; streaming = false; state = 'idle'
      }
    }
    ws.onclose = () => { if (state !== 'error') state = 'closed' }
    ws.onerror = () => (state = 'error — not a live pi rpc thread?')
  }
  async function scrollDown() { await tick(); scroller?.scrollTo(0, scroller.scrollHeight) }

  function send() {
    const text = draft.trim()
    if (!text || !ws || ws.readyState !== 1) return
    msgs = [...msgs, { role: 'user', text }]
    draft = ''
    streamIdx = null
    ws.send(JSON.stringify({ message: text }))
  }
  function onkey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // Connect ONCE per thread. The parent re-polls the grid (reassigning the selected row),
  // so guard against re-runs that would wipe msgs and leak sockets.
  $effect(() => {
    const id = threadId
    if (id === connectedFor) return
    connectedFor = id
    msgs = []; streamIdx = null; streaming = false; state = 'connecting…'
    try { ws?.close() } catch {}
    open(id)
  })
  onDestroy(() => { try { ws?.close() } catch {} })
</script>

<div class="chat">
  <div class="ribbon">⚡ pi RPC · streaming · {state}</div>
  <div class="log" bind:this={scroller}>
    {#each msgs as m}
      <div class="bubble {m.role}">{m.text}{#if m.role === 'assistant' && streaming && m === msgs[msgs.length - 1]}<span class="cursor"></span>{/if}</div>
    {/each}
    {#if msgs.length === 0}<div class="empty">Send a message to stream a turn from the live pi agent.</div>{/if}
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
