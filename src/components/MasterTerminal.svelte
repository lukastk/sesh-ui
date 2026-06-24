<script>
  // Live xterm.js terminal for the MASTER cockpit over the daemon WebSocket
  // GET /v1/master/terminal?cols=&rows= (runs ui_config.master_command in a pty server-side).
  // The xterm setup mirrors Terminal.svelte (same FitAddon, resize frame, binary read/write) but
  // there's no thread/blob context here — just the master tmux attach. `machine` routes the WS to a
  // peer's master endpoint (the wsURL seam injects the token + __machine).
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { onMount, onDestroy } from 'svelte'
  import { App as CapApp } from '@capacitor/app'
  import { api, sesh } from '../lib/seshClient.js'
  import { fontScale, bumpTerm, setTerm } from '../lib/fontscale.svelte.js'
  import { pinch } from '../lib/pinch.js'
  import ExtraKeys from './chat/ExtraKeys.svelte'

  let { machine = undefined } = $props()  // which machine's master cockpit (undefined = connected)
  // Termux-style extra-keys row (Android only) — same layout as the thread terminal, from the
  // connected daemon's ui_config.extra_keys (empty = no row).
  let extraKeys = $state('')
  $effect(() => { api.uiConfigGet().then((r) => { extraKeys = r.ui_config?.extra_keys || '' }).catch(() => {}) })
  const sendKeys = (b) => { if (b && ws?.readyState === 1) ws.send(b) }
  const openKeyboard = () => term?.focus()
  let el
  let term, fit, ws, ro
  let destroyed = false   // set in onDestroy so a teardown close never triggers a reconnect
  let capHandle           // Capacitor App 'resume' listener handle (Android only)
  // The whole app is `zoom: scale`; counter it here so the terminal renders at net zoom 1 (crisp),
  // controlled ONLY by its own xterm fontSize (fontScale.term) — matching the thread terminal.
  let counterZoom = $derived(1 / fontScale.scale)

  // Touch-swipe scrolling (Android): synthesize wheel events from a one-finger vertical drag so
  // xterm's own handler scrolls the scrollback / sends cursor keys (a touch swipe emits no wheel).
  let touchY = null
  function onTouchStart(e) { if (e.touches.length === 1) touchY = e.touches[0].clientY }
  function onTouchMove(e) {
    if (touchY == null || e.touches.length !== 1) return
    const y = e.touches[0].clientY
    const dy = touchY - y
    touchY = y
    if (!dy) return
    const tgt = el.querySelector('.xterm-viewport') || el
    tgt.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true }))
  }
  function onTouchEnd() { touchY = null }

  // Pinch-to-zoom over the terminal → its OWN font size (fontScale.term), independent of app scale.
  let pinchBaseTerm = 13
  function onPinchStart() { pinchBaseTerm = fontScale.term }
  function onPinchMove(scale) { setTerm(Math.round(pinchBaseTerm * scale)) }

  // Open (or re-open) the master-cockpit WS. Split out of connect() so we can re-attach on resume:
  // a fresh attach just re-runs master_command's pty viewer server-side. Guarded so we never stack
  // sockets. A failed upgrade (e.g. master_command unset → 409) or a dropped attach lands in onclose.
  function openSocket() {
    if (destroyed || !term) return
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
    ws = new WebSocket(api.masterURL(term.cols, term.rows, machine))
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    ws.onmessage = (ev) => term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data))
    // The screen pre-checks master_command and shows a clear notice for the 409 case; this is the
    // in-pane note for a dropped attach.
    ws.onclose = () => { if (!destroyed) term?.write('\r\n\x1b[2m[master terminal disconnected]\x1b[0m\r\n') }
  }

  // Reconnect-on-resume: Android tears down the WS when the display turns off / the app is
  // backgrounded and it does not come back on its own. Re-open on Capacitor App 'resume' or when the
  // page becomes visible again. openSocket's guard makes this a no-op when the socket is already live.
  function reconnect() {
    if (destroyed || !term) return
    openSocket()
  }
  function onVisibility() { if (document.visibilityState === 'visible') reconnect() }

  function connect() {
    term = new Terminal({
      cursorBlink: true, fontSize: fontScale.term, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      scrollback: 5000,
      theme: { background: '#16161e', foreground: '#c0caf5', cursor: '#7aa2f7' },
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()

    openSocket()
    term.onData((d) => ws?.readyState === 1 && ws.send(d))

    // Re-attach when the app/display comes back (Android 'resume'; visibilitychange as the
    // cross-platform fallback and the only signal in web/Electron).
    document.addEventListener('visibilitychange', onVisibility)
    if (sesh.transport === 'android') CapApp.addListener('resume', reconnect).then((h) => (capHandle = h))

    ro = new ResizeObserver(() => {
      try { fit.fit() } catch {}
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    })
    ro.observe(el)
    el.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    el.addEventListener('touchmove', onTouchMove, { capture: true, passive: true })
    el.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true })
  }
  onMount(connect)
  onDestroy(() => {
    destroyed = true
    try { document.removeEventListener('visibilitychange', onVisibility) } catch {}
    try { capHandle?.remove() } catch {}
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

  // React to the terminal font size OR the app scale changing: update xterm, refit, tell the pty.
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
  <div class="tctl">
    <button onclick={() => bumpTerm(-1)} title="smaller terminal font" aria-label="smaller terminal font">A−</button>
    <button onclick={() => bumpTerm(1)} title="larger terminal font" aria-label="larger terminal font">A+</button>
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
</style>
