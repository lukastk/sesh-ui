<script>
  // Transcript-bubble chat for a headless claude/codex thread: render the on-disk transcript
  // (JSONL → bubbles), and a composer that does send-headless → poll headless-reply → reload.
  // The three agents write DIFFERENT JSONL schemas, so there's a typed parser per agent_kind
  // with a raw fallback. (A normalized sesh-side chat stream would replace these — PLAN.md.)
  import { tick } from 'svelte'
  import { api } from '../../lib/seshClient.js'
  import { parseTranscript } from '../../lib/transcript.js'
  import { getCachedTranscript, putCachedTranscript } from '../../lib/transcriptCache.js'
  import { uploadBlob } from '../../lib/blobs.js'
  import { modelSuggestions } from '../../lib/models.js'
  import Markdown from '../Markdown.svelte'

  // headful: this thread has a LIVE pane (claude/codex viewed in transcript mode) — the composer
  // delivers via `thread send` (send-keys into the pane), NOT send-headless, and the transcript is
  // polled so the live agent's streamed reply appears.
  // `busy` is the thread's live state ("busy" while a turn is in flight — a headful pane
  // mid-turn or a headless turn running, detected daemon-side); it drives the "thinking"
  // bubble even for turns NOT started from this app (typed into the pane, fired from the TUI).
  let { threadId, agentKind = 'pi', machine = undefined, headful = false, busy = 'idle' } = $props()

  let msgs = $state([])       // {role, text, thinking?}
  let draft = $state('')
  let sending = $state(false)
  let loading = $state(false) // the INITIAL transcript fetch is in flight (no cache to show yet)
  let loadErr = $state(null)
  let atBottom = $state(true)
  let scroller
  let loadedFor = null
  let turnModel = $state('')      // optional per-turn model override (headless only; pass-through)
  let attachments = $state([])    // {name, token} blobs referenced in the draft
  let uploading = $state(false)
  let fileInput
  let composerEl = $state(null)   // the message textarea — auto-focused on mount (entering this view)

  // Focus the composer as soon as the view mounts, so opening a thread / entering Transcript mode
  // lets you type immediately (the surface is keyed per thread+view, so this fires on each switch).
  $effect(() => { composerEl?.focus() })

  // Upload files to the thread's owning blob store and drop an @blob(hash) token into the draft.
  async function attachFiles(files) {
    const list = [...(files || [])]
    if (!list.length) return
    uploading = true
    try {
      for (const f of list) {
        const b = await uploadBlob(f, machine)
        attachments = [...attachments, { name: b.name, token: b.token }]
        draft = (draft ? draft.replace(/\s*$/, '') + ' ' : '') + b.token + ' '
      }
    } catch (e) { msgs = [...msgs, { role: 'error', text: 'attach failed: ' + (e.message ?? e) }] }
    finally { uploading = false }
  }
  function onPaste(e) {
    const files = [...(e.clipboardData?.files || [])]
    if (files.length) { e.preventDefault(); attachFiles(files) }
  }
  function onDrop(e) { e.preventDefault(); attachFiles(e.dataTransfer?.files) }
  function removeAttachment(a) {
    attachments = attachments.filter((x) => x !== a)
    draft = draft.split(a.token).join('').replace(/[ \t]{2,}/g, ' ').replace(/^\s+/, '')
  }

  async function load() {
    try {
      const t = await api.transcript(threadId, 300, machine)
      msgs = parseTranscript(t.lines || [], agentKind)
      putCachedTranscript(threadId, msgs)
      loadErr = null
      await scrollDown()
    } catch (e) {
      // A thread that has never run a turn has no transcript yet — a LEGITIMATE empty state,
      // not a failure. Render it as empty; surface every other transcript error loudly.
      if (/no transcript/i.test(String(e))) { msgs = []; loadErr = null; putCachedTranscript(threadId, []) }
      else loadErr = String(e)
    } finally {
      loading = false   // the initial fetch has resolved — "No transcript yet" is now truthful
    }
  }
  function onScroll() {
    if (!scroller) return
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48
  }
  async function scrollDown(force = false) {
    if (!force && !atBottom) return   // user scrolled up — don't yank them down
    await tick()
    scroller?.scrollTo(0, scroller.scrollHeight)
    atBottom = true
  }

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    sending = true
    msgs = [...msgs, { role: 'user', text }]
    draft = ''
    attachments = []            // the @blob tokens are now in the sent text
    await scrollDown(true)      // sending always snaps to the latest
    try {
      if (headful) {
        // Deliver into the LIVE pane (send-keys + submit); the agent replies asynchronously into
        // its transcript, which the periodic poll (below) picks up. Quick reload for the echo.
        await api.send(threadId, text, machine)
        await load()
      } else {
        await api.sendHeadless(threadId, text, machine, turnModel.trim() || undefined)
        // Poll until the turn completes, then reload the durable transcript for the full turn.
        for (let i = 0; i < 180; i++) {
          const r = await api.headlessReply(threadId, machine)
          if (!r.working && r.have_reply) break
          await new Promise((res) => setTimeout(res, 1000))
        }
        await load()
      }
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
    // Show the prefetched transcript INSTANTLY if we have it, then refresh in the background. Only
    // when there's no cache do we enter the "Loading…" state for the initial fetch.
    const cached = getCachedTranscript(threadId)
    msgs = cached || []
    loading = !cached
    atBottom = true
    // Open at the LATEST, not the top. The cached render paints instantly (loading=false), but the
    // first scrollDown otherwise waits for the fresh fetch in load() to resolve — on a slow/remote
    // daemon that leaves the view stuck at the top until the network lands. Snap down now too.
    if (cached?.length) scrollDown(true)
    load()
  })
  // A headful pane's reply streams into the transcript over time — poll-reload while viewing it
  // (skip while a send is in flight so the optimistic bubble isn't clobbered mid-send).
  $effect(() => {
    if (!headful) return
    const t = setInterval(() => { if (!sending) load() }, 2500)
    return () => clearInterval(t)
  })
</script>

<div class="chat">
  <div class="log" bind:this={scroller} onscroll={onScroll}>
    {#if loadErr}<div class="bubble error">{loadErr}</div>{/if}
    {#each msgs as m, i (i)}
      <div class="bubble {m.role}">
        {#if m.thinking}<div class="thinking">{m.thinking}</div>{/if}
        {#if m.text}{#if m.role === 'user' || m.role === 'error'}<div class="text">{m.text}</div>{:else}<div class="text"><Markdown text={m.text} /></div>{/if}{/if}
      </div>
    {/each}
    {#if sending || busy === 'busy'}<div class="bubble assistant pending">…thinking</div>{/if}
    {#if msgs.length === 0 && !loadErr && !sending && busy !== 'busy'}
      {#if loading}<div class="empty">Loading…</div>
      {:else}<div class="empty">{headful ? 'No transcript yet — send a message into the live pane below.' : 'No transcript yet — send a headless turn below.'}</div>{/if}
    {/if}
  </div>
  {#if !atBottom}
    <button class="jump" onclick={() => scrollDown(true)} title="jump to latest">↓ latest</button>
  {/if}
  <div class="composer-wrap" ondragover={(e) => e.preventDefault()} ondrop={onDrop} role="group">
    {#if attachments.length}
      <div class="chips">
        {#each attachments as a (a.token)}
          <span class="chip">📎 {a.name}<button onclick={() => removeAttachment(a)} aria-label="remove attachment">×</button></span>
        {/each}
      </div>
    {/if}
    {#if !headful}
      <div class="modelrow">
        <span class="ml-label">model</span>
        <input bind:value={turnModel} list="hl-model-suggestions" placeholder="(thread default · this turn only)" autocomplete="off" />
        <datalist id="hl-model-suggestions">
          {#each modelSuggestions(agentKind) as m}<option value={m}></option>{/each}
        </datalist>
      </div>
    {/if}
    <div class="composer">
      <textarea bind:this={composerEl} bind:value={draft} placeholder={headful ? 'Send into the live pane… (⌘/Ctrl+Enter) · drop/paste a file' : 'Send a headless turn… (⌘/Ctrl+Enter) · drop or paste a file to attach'} onkeydown={onkey} onpaste={onPaste}></textarea>
      <input type="file" multiple bind:this={fileInput} onchange={(e) => { attachFiles(e.currentTarget.files); e.currentTarget.value = '' }} style="display:none" />
      <button class="attach" onclick={() => fileInput.click()} disabled={uploading} title="attach file / image">{uploading ? '…' : '📎'}</button>
      <button onclick={send} disabled={sending}>{sending ? '…' : 'Send'}</button>
    </div>
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative; }
  .log { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 14px;
    display: flex; flex-direction: column; gap: 10px; }
  .jump { position: absolute; bottom: 70px; left: 50%; transform: translateX(-50%); z-index: 5;
    background: #7aa2f7; color: #11121a; border: 0; border-radius: 16px; padding: 5px 13px;
    font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: 0 3px 12px rgba(0,0,0,0.5); }
  .bubble { max-width: 80%; padding: 8px 12px; border-radius: 10px; white-space: pre-wrap;
    font-size: 13px; line-height: 1.45; word-break: break-word; }
  .bubble.user { align-self: flex-end; background: #3d59a1; color: #fff; }
  .bubble.assistant { align-self: flex-start; background: #232433; color: #c0caf5; }
  .bubble.error { align-self: center; background: #5a2030; color: #ffb4c0; font-size: 12px; }
  .pending { opacity: 0.6; font-style: italic; }
  .empty { color: #565f89; font-size: 13px; margin: auto; }
  .thinking { opacity: 0.5; font-style: italic; font-size: 12px; margin-bottom: 6px;
    border-left: 2px solid #565f89; padding-left: 6px; }
  .composer-wrap { border-top: 1px solid #1f2030; background: #16161e; flex-shrink: 0; }
  .modelrow { display: flex; align-items: center; gap: 8px; padding: 8px 10px 0; }
  .modelrow .ml-label { font-size: 10px; color: #565f89; text-transform: uppercase; letter-spacing: 0.05em; }
  .modelrow input { flex: 1; background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px;
    padding: 4px 9px; font-size: 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px 0; }
  .chip { display: inline-flex; align-items: center; gap: 5px; background: #1a2733; color: #7dcfff;
    border: 1px solid #1e3a4a; border-radius: 6px; padding: 3px 7px; font-size: 11px; }
  .chip button { background: none; border: 0; color: #7dcfff; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
  .composer { display: flex; gap: 8px; padding: 10px; }
  .attach { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 8px;
    padding: 0 12px; cursor: pointer; font-size: 15px; min-width: 44px; }
  .attach:disabled { opacity: 0.5; }
  textarea { flex: 1; resize: none; height: 46px; background: #1a1b26; color: #c0caf5;
    border: 1px solid #2a2b3d; border-radius: 8px; padding: 8px; font-family: inherit; font-size: 13px; }
  button { background: #7aa2f7; color: #16161e; border: 0; border-radius: 8px; padding: 0 16px;
    font-weight: 600; cursor: pointer; min-width: 56px; }
  button:disabled { opacity: 0.5; }
</style>
