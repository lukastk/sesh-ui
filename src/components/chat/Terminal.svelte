<script>
  // Live xterm.js terminal for a headful thread over the daemon WebSocket
  // GET /v1/threads/terminal?id=&cols=&rows= (agent-agnostic, detach-safe server-side).
  // Bidirectional: pane bytes → xterm, keystrokes → pane; {type:'resize'} on fit changes.
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { onMount, onDestroy } from 'svelte'
  import { api } from '../../lib/seshClient.js'

  let { threadId } = $props()
  let el
  let term, fit, ws, ro

  function connect() {
    term = new Terminal({
      cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#16161e', foreground: '#c0caf5', cursor: '#7aa2f7' },
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()

    ws = new WebSocket(api.terminalURL(threadId, term.cols, term.rows))
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
  }
  onMount(connect)
  onDestroy(() => {
    try { ro?.disconnect() } catch {}
    try { ws?.close() } catch {}
    try { term?.dispose() } catch {}
  })
</script>

<div class="term" bind:this={el}></div>

<style>
  .term { height: 100%; width: 100%; background: #16161e; padding: 6px; box-sizing: border-box; overflow: hidden; }
</style>
