<script>
  // Transcript-bubble chat for a headless claude/codex thread: render the on-disk transcript
  // (JSONL → bubbles), and a composer that does send-headless → poll headless-reply → reload.
  // The three agents write DIFFERENT JSONL schemas, so there's a typed parser per agent_kind
  // with a raw fallback. (A normalized sesh-side chat stream would replace these — PLAN.md.)
  import { tick } from 'svelte'
  import { api } from '../../lib/seshClient.js'

  let { threadId, agentKind = 'pi' } = $props()

  let msgs = $state([])       // {role, text, thinking?}
  let draft = $state('')
  let sending = $state(false)
  let loadErr = $state(null)
  let scroller
  let loadedFor = null

  const PARSERS = {
    // pi: {type:"message", message:{role, content:[{type:"text"|"thinking", text/thinking}]}}
    pi(o) {
      if (o.type !== 'message' || !o.message) return null
      const c = o.message.content || []
      return mk(o.message.role,
        c.filter((x) => x.type === 'text').map((x) => x.text).join('\n'),
        c.filter((x) => x.type === 'thinking').map((x) => x.thinking).join('\n'))
    },
    // claude: {type:"user"|"assistant", message:{role, content: string | [{type:"text",text}]}}
    claude(o) {
      if (o.type !== 'user' && o.type !== 'assistant') return null
      const content = o.message?.content
      if (typeof content === 'string') return mk(o.message.role, content)
      const arr = content || []
      return mk(o.message?.role,
        arr.filter((x) => x.type === 'text').map((x) => x.text).join('\n'),
        arr.filter((x) => x.type === 'thinking').map((x) => x.thinking).join('\n'))
    },
    // codex: {type:"response_item", payload:{type:"message", role, content:[{type:"input_text"|"output_text", text}]}}
    codex(o) {
      if (o.type !== 'response_item' || o.payload?.type !== 'message') return null
      const role = o.payload.role
      if (role !== 'user' && role !== 'assistant') return null
      const text = (o.payload.content || [])
        .filter((x) => x.type === 'input_text' || x.type === 'output_text').map((x) => x.text).join('\n')
      if (role === 'user' && /^\s*<(environment_context|permissions)/.test(text)) return null
      return mk(role, text)
    },
  }
  function mk(role, text, thinking) {
    if (!text && !thinking) return null
    return { role, text: text || '', thinking: thinking || '' }
  }
  function parse(lines) {
    const p = PARSERS[agentKind] || PARSERS.pi
    const out = []
    for (const raw of lines) {
      let o
      try { o = JSON.parse(raw) } catch { continue }
      const m = p(o)
      if (m) out.push(m)
    }
    return out
  }

  async function load() {
    try {
      const t = await api.transcript(threadId, 300)
      msgs = parse(t.lines || [])
      loadErr = null
      await scrollDown()
    } catch (e) {
      // A thread that has never run a turn has no transcript yet — a LEGITIMATE empty state,
      // not a failure. Render it as empty; surface every other transcript error loudly.
      if (/no transcript/i.test(String(e))) { msgs = []; loadErr = null }
      else loadErr = String(e)
    }
  }
  async function scrollDown() { await tick(); scroller?.scrollTo(0, scroller.scrollHeight) }

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    sending = true
    msgs = [...msgs, { role: 'user', text }]
    draft = ''
    await scrollDown()
    try {
      await api.sendHeadless(threadId, text)
      // Poll until the turn completes, then reload the durable transcript for the full turn.
      for (let i = 0; i < 180; i++) {
        const r = await api.headlessReply(threadId)
        if (!r.working && r.have_reply) break
        await new Promise((res) => setTimeout(res, 1000))
      }
      await load()
    } catch (e) {
      msgs = [...msgs, { role: 'error', text: String(e) }]
    } finally {
      sending = false
      await scrollDown()
    }
  }
  function onkey(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
  }

  $effect(() => {
    if (threadId === loadedFor) return
    loadedFor = threadId
    msgs = []
    load()
  })
</script>

<div class="chat">
  <div class="log" bind:this={scroller}>
    {#if loadErr}<div class="bubble error">{loadErr}</div>{/if}
    {#each msgs as m}
      <div class="bubble {m.role}">
        {#if m.thinking}<div class="thinking">{m.thinking}</div>{/if}
        {#if m.text}<div class="text">{m.text}</div>{/if}
      </div>
    {/each}
    {#if sending}<div class="bubble assistant pending">…thinking</div>{/if}
    {#if msgs.length === 0 && !loadErr && !sending}<div class="empty">No transcript yet — send a headless turn below.</div>{/if}
  </div>
  <div class="composer">
    <textarea bind:value={draft} placeholder="Send a headless turn… (⌘/Ctrl+Enter)" onkeydown={onkey}></textarea>
    <button onclick={send} disabled={sending}>{sending ? '…' : 'Send'}</button>
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .bubble { max-width: 80%; padding: 8px 12px; border-radius: 10px; white-space: pre-wrap;
    font-size: 13px; line-height: 1.45; word-break: break-word; }
  .bubble.user { align-self: flex-end; background: #3d59a1; color: #fff; }
  .bubble.assistant { align-self: flex-start; background: #232433; color: #c0caf5; }
  .bubble.error { align-self: center; background: #5a2030; color: #ffb4c0; font-size: 12px; }
  .pending { opacity: 0.6; font-style: italic; }
  .empty { color: #565f89; font-size: 13px; margin: auto; }
  .thinking { opacity: 0.5; font-style: italic; font-size: 12px; margin-bottom: 6px;
    border-left: 2px solid #565f89; padding-left: 6px; }
  .composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #1f2030;
    background: #16161e; flex-shrink: 0; }
  textarea { flex: 1; resize: none; height: 46px; background: #1a1b26; color: #c0caf5;
    border: 1px solid #2a2b3d; border-radius: 8px; padding: 8px; font-family: inherit; font-size: 13px; }
  button { background: #7aa2f7; color: #16161e; border: 0; border-radius: 8px; padding: 0 16px;
    font-weight: 600; cursor: pointer; min-width: 56px; }
  button:disabled { opacity: 0.5; }
</style>
