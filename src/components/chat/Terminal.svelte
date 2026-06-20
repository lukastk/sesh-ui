<script>
  // Live xterm.js terminal for a headful thread over the daemon WebSocket
  // GET /v1/threads/terminal?id=&cols=&rows= (agent-agnostic, detach-safe server-side).
  // Bidirectional: pane bytes → xterm, keystrokes → pane; {type:'resize'} on fit changes.
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { onMount, onDestroy } from 'svelte'
  import { api } from '../../lib/seshClient.js'
  import { uploadBlobPath } from '../../lib/blobs.js'
  import { fontScale, bumpTerm } from '../../lib/fontscale.svelte.js'

  let { threadId, machine = undefined } = $props()  // machine: dial a remote thread's owning daemon
  let el
  let term, fit, ws, ro
  let fileInput
  let uploading = $state(false)
  // The whole app is `zoom: scale`; counter it here so the terminal renders at net zoom 1 (crisp),
  // controlled ONLY by its own xterm fontSize (fontScale.term) — the ticket's "separate" terminal size.
  let counterZoom = $derived(1 / fontScale.scale)

  // Headful attach: upload to the THREAD's blob store, resolve the on-disk path, and TYPE it into
  // the live pty over the terminal WS (like keystrokes) — trailing space, no Enter. The agent reads
  // the file from that path. (No @blob() expansion: the pty agent is typed into directly.)
  async function attachFiles(files) {
    const list = [...(files || [])]
    if (!list.length || !ws || ws.readyState !== 1) return
    uploading = true
    try {
      for (const f of list) {
        const b = await uploadBlobPath(f, machine)
        ws.send(b.path + ' ')   // type the resolved path into the pane (the pane echoes it back)
      }
    } catch (e) {
      term?.write('\r\n\x1b[31m[attach failed: ' + (e.message ?? e) + ']\x1b[0m\r\n')
    } finally { uploading = false; term?.focus() }
  }
  // Catch an IMAGE/file paste before xterm's textarea consumes it; let a plain TEXT paste through.
  function onPasteCapture(e) {
    const files = [...(e.clipboardData?.files || [])]
    if (files.length) { e.preventDefault(); e.stopImmediatePropagation(); attachFiles(files) }
  }

  function connect() {
    term = new Terminal({
      cursorBlink: true, fontSize: fontScale.term, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#16161e', foreground: '#c0caf5', cursor: '#7aa2f7' },
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()

    ws = new WebSocket(api.terminalURL(threadId, term.cols, term.rows, machine))
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    ws.onmessage = (ev) => term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data))
    ws.onclose = () => term.write('\r\n\x1b[2m[terminal disconnected]\x1b[0m\r\n')
    term.onData((d) => ws.readyState === 1 && ws.send(d))

    ro = new ResizeObserver(() => {
      try { fit.fit() } catch {}
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    })
    ro.observe(el)
    // Capture phase so we see an image paste before xterm's textarea does.
    el.addEventListener('paste', onPasteCapture, true)
  }
  onMount(connect)
  onDestroy(() => {
    try { el?.removeEventListener('paste', onPasteCapture, true) } catch {}
    try { ro?.disconnect() } catch {}
    try { ws?.close() } catch {}
    try { term?.dispose() } catch {}
  })

  // React to the terminal font size OR the app scale changing: update xterm, refit, tell the pane.
  $effect(() => {
    const size = fontScale.term, sc = fontScale.scale // track both
    void sc
    if (!term) return
    term.options.fontSize = size
    Promise.resolve().then(() => {
      try { fit.fit() } catch {}
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    })
  })
</script>

<div class="termwrap" style="zoom:{counterZoom}">
  <div class="term" bind:this={el}></div>
  <input type="file" multiple bind:this={fileInput} onchange={(e) => { attachFiles(e.currentTarget.files); e.currentTarget.value = '' }} style="display:none" />
  <div class="tctl">
    <button onclick={() => bumpTerm(-1)} title="smaller terminal font" aria-label="smaller terminal font">A−</button>
    <button onclick={() => bumpTerm(1)} title="larger terminal font" aria-label="larger terminal font">A+</button>
    <button class="attach" onclick={() => fileInput.click()} disabled={uploading}
      title="attach file / image (types its path into the terminal)">{uploading ? '…' : '📎'}</button>
  </div>
</div>

<style>
  .termwrap { position: relative; height: 100%; width: 100%; }
  .term { height: 100%; width: 100%; background: #16161e; padding: 6px; box-sizing: border-box; overflow: hidden; }
  .tctl { position: absolute; top: 8px; right: 14px; z-index: 5; display: flex; align-items: center; gap: 4px; }
  .tctl button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px;
    padding: 3px 8px; font-size: 12px; cursor: pointer; opacity: 0.7; }
  .tctl button:hover { opacity: 1; }
  .tctl button:disabled { opacity: 0.45; }
  .tctl .attach { font-size: 14px; }
</style>
