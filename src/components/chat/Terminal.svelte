<script>
  // Live xterm.js terminal for a headful thread over the daemon WebSocket
  // GET /v1/threads/terminal?id=&cols=&rows= (agent-agnostic; server-side the daemon attaches
  // the pty DIRECTLY to the thread's real tmux session — sizing follows the work server's
  // `window-size latest`, so the view adapts to whichever client is most-recently active).
  // Bidirectional: pane bytes → xterm, keystrokes → pane; {type:'resize'} on fit changes.
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { onMount, onDestroy } from 'svelte'
  import { App as CapApp } from '@capacitor/app'
  import { api, sesh } from '../../lib/seshClient.js'
  import { uploadBlobPath } from '../../lib/blobs.js'
  import { fontScale, bumpTerm, setTerm } from '../../lib/fontscale.svelte.js'
  import { pinch } from '../../lib/pinch.js'
  import { prefs } from '../../lib/uiprefs.svelte.js'
  import ExtraKeys from './ExtraKeys.svelte'

  let { threadId, machine = undefined } = $props()  // machine: dial a remote thread's owning daemon
  // Termux-style extra-keys row (Android only) — layout from the CONNECTED daemon's ui_config
  // (a per-app preference; empty = no row). Sent straight to the pty like keystrokes.
  let extraKeys = $state('')
  $effect(() => { api.uiConfigGet().then((r) => { extraKeys = r.ui_config?.extra_keys || '' }).catch(() => {}) })
  const sendKeys = (b) => { if (b && ws?.readyState === 1) ws.send(b) }
  const openKeyboard = () => term?.focus()
  let el
  let term, fit, ws, ro
  let destroyed = false   // set in onDestroy so a teardown close never triggers a reconnect
  let capHandle           // Capacitor App 'resume' listener handle (Android only)
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

  // Touch-swipe scrolling (Android): a touch swipe never produces the `wheel` events xterm scrolls
  // on, so we drive scrolling ourselves from a one-finger vertical drag. We take FULL control —
  // preventDefault + stopImmediatePropagation in the capture phase — so neither the browser's native
  // overflow scroll NOR xterm's built-in touch handler also fires. xterm's own handler is the reason
  // a sensitivity setting did nothing: in the normal buffer it scrolls a hard-coded 1:1 (`scrollTop
  // += rawDelta`, ignoring scrollSensitivity), and for a mouse-tracking alt-screen TUI (claude/codex,
  // the usual thread view) it forwards exactly ONE wheel notch per move event regardless of delta —
  // so scaling the delta was a no-op. Instead we accumulate (finger-delta × sensitivity) and emit one
  // DOM_DELTA_LINE wheel notch per row of travel, letting xterm do the right thing in EVERY mode
  // (scrollback in the normal buffer; mouse-wheel events to a mouse-tracking TUI; cursor keys to a
  // plain alt-screen TUI). More notches per swipe ⇒ the sensitivity pref actually bites.
  // Natural direction: drag up → newer (scroll toward the bottom), drag down → older.
  let touchY = null, touchAccum = 0
  // Pixel height of one rendered row, in the same (post-`zoom`) screen-px space as clientY — so the
  // notch step matches finger travel. Measured from the live row stripe; 24 is a sane pre-render fallback.
  function rowPx() {
    const rows = el.querySelector('.xterm-rows')
    const h = rows && term?.rows ? rows.getBoundingClientRect().height / term.rows : 0
    return h > 0 ? h : 24
  }
  function onTouchStart(e) {
    if (e.touches.length === 1) { touchY = e.touches[0].clientY; touchAccum = 0 }
  }
  function onTouchMove(e) {
    if (touchY == null || e.touches.length !== 1) return
    e.preventDefault(); e.stopImmediatePropagation()   // claim the gesture from native + xterm scroll
    const y = e.touches[0].clientY
    touchAccum += (touchY - y) * prefs.termScrollSensitivity
    touchY = y
    const step = rowPx()
    const tgt = el.querySelector('.xterm-viewport') || el
    while (Math.abs(touchAccum) >= step) {
      const dir = touchAccum > 0 ? 1 : -1
      tgt.dispatchEvent(new WheelEvent('wheel', { deltaY: dir, deltaMode: 1, bubbles: true, cancelable: true }))
      touchAccum -= dir * step
    }
  }
  function onTouchEnd() { touchY = null; touchAccum = 0 }

  // Pinch-to-zoom over the terminal → its OWN font size (fontScale.term), independent of the app
  // scale. Reuses the shared store, so the A−/A+ buttons and the desktop controls all stay in sync.
  let pinchBaseTerm = 13
  function onPinchStart() { pinchBaseTerm = fontScale.term }
  function onPinchMove(scale) { setTerm(Math.round(pinchBaseTerm * scale)) }

  // Open (or re-open) the terminal WS to the daemon. Split out of connect() so we can re-attach on
  // resume: each connection is a fresh DIRECT attach to the thread's real session server-side, so a
  // clean re-open just redraws the current pane — no client state to restore. Guarded so we never stack sockets.
  function openSocket() {
    if (destroyed || !term) return
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
    ws = new WebSocket(api.terminalURL(threadId, term.cols, term.rows, machine))
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    ws.onmessage = (ev) => term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data))
    ws.onclose = () => { if (!destroyed) term?.write('\r\n\x1b[2m[terminal disconnected]\x1b[0m\r\n') }
  }

  // Reconnect-on-resume: Android tears down the WS when the display turns off / the app is
  // backgrounded, and it does NOT come back on its own. Re-open the socket when the OS resumes the
  // app (Capacitor App 'resume') or the page becomes visible again (covers desktop/web tab-hide too).
  // The openSocket guard makes this a no-op when the socket is already live.
  function reconnect() {
    if (destroyed || !term) return
    openSocket()
  }
  function onVisibility() { if (document.visibilityState === 'visible') reconnect() }

  function connect() {
    term = new Terminal({
      cursorBlink: true, fontSize: fontScale.term, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      scrollback: 5000,  // a real scrollback buffer to scroll through (was the implicit small default)
      theme: { background: '#16161e', foreground: '#c0caf5', cursor: '#7aa2f7' },
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()
    // Auto-focus on open only when the composer-autofocus pref is on (default OFF on Android) — the
    // terminal is the DEFAULT thread view, so focusing it on mount was popping the soft keyboard the
    // instant a thread opened (the HeadlessChat/RpcChat composers were already gated, the terminal
    // wasn't). Off → the user taps the terminal to start typing.
    if (prefs.composerAutofocus) term.focus()

    openSocket()
    term.onData((d) => ws?.readyState === 1 && ws.send(d))

    // Re-attach when the app/display comes back. Android fires Capacitor App 'resume'; the
    // visibilitychange listener is the cross-platform fallback (and the only signal in web/Electron).
    document.addEventListener('visibilitychange', onVisibility)
    if (sesh.transport === 'android') CapApp.addListener('resume', reconnect).then((h) => (capHandle = h))

    ro = new ResizeObserver(() => {
      try { fit.fit() } catch {}
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    })
    ro.observe(el)
    // Capture phase so we see an image paste before xterm's textarea does.
    el.addEventListener('paste', onPasteCapture, true)
    // Touch-swipe → scroll. Capture phase so we run BEFORE xterm's own (descendant) touch handler and
    // can stopImmediatePropagation it; touchmove is non-passive so onTouchMove can preventDefault the
    // native overflow scroll (touchstart/end stay passive — they never need to cancel).
    el.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    el.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    el.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true })
  }
  onMount(connect)
  onDestroy(() => {
    destroyed = true
    try { document.removeEventListener('visibilitychange', onVisibility) } catch {}
    try { capHandle?.remove() } catch {}
    try { el?.removeEventListener('paste', onPasteCapture, true) } catch {}
    try {
      el?.removeEventListener('touchstart', onTouchStart, { capture: true })
      el?.removeEventListener('touchmove', onTouchMove, { capture: true })
      el?.removeEventListener('touchend', onTouchEnd, { capture: true })
      el?.removeEventListener('touchcancel', onTouchEnd, { capture: true })
    } catch {}
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

<div class="termwrap" style="zoom:{counterZoom}" use:pinch={{ onpinchstart: onPinchStart, onpinch: onPinchMove }}>
  <div class="term" bind:this={el}></div>
  <input type="file" multiple bind:this={fileInput} onchange={(e) => { attachFiles(e.currentTarget.files); e.currentTarget.value = '' }} style="display:none" />
  <div class="tctl">
    <button onclick={() => bumpTerm(-1)} title="smaller terminal font" aria-label="smaller terminal font">A−</button>
    <button onclick={() => bumpTerm(1)} title="larger terminal font" aria-label="larger terminal font">A+</button>
    <button class="attach" onclick={() => fileInput.click()} disabled={uploading}
      title="attach file / image (types its path into the terminal)">{uploading ? '…' : '📎'}</button>
  </div>
  {#if sesh.transport === 'android'}<ExtraKeys keysJson={extraKeys} onsend={sendKeys} onkeyboard={openKeyboard} />{/if}
</div>

<style>
  .termwrap { position: relative; height: 100%; width: 100%; display: flex; flex-direction: column; }
  .term { flex: 1; min-height: 0; width: 100%; background: #16161e; padding: 6px; box-sizing: border-box; overflow: hidden; }
  .tctl { position: absolute; top: 8px; right: 14px; z-index: 5; display: flex; align-items: center; gap: 4px; }
  .tctl button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px;
    padding: 3px 8px; font-size: 12px; cursor: pointer; opacity: 0.7; }
  .tctl button:hover { opacity: 1; }
  .tctl button:disabled { opacity: 0.45; }
  .tctl .attach { font-size: 14px; }
</style>
