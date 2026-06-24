<script>
  // Termux-style extra-keys row(s) shown above the soft keyboard in the terminal / master views on
  // Android. Layout comes from ui_config.extra_keys (parsed JSON). Each key press sends bytes to the
  // pty via onsend(); CTRL/ALT are STICKY (one-shot, applied to the next key); KEYBOARD re-opens the
  // soft keyboard (onkeyboard); PASTE pipes the clipboard in; a {key,popup} fires popup on long-press.
  import { parseExtraKeys, describeKey, keyBytes, macroBytes } from '../../lib/extrakeys.js'

  let { keysJson = '', onsend, onkeyboard } = $props()

  let rows = $derived(parseExtraKeys(keysJson))
  let sticky = $state({ ctrl: false, alt: false })
  const clearSticky = () => { if (sticky.ctrl || sticky.alt) sticky = { ctrl: false, alt: false } }

  async function paste() {
    try { const t = await navigator.clipboard.readText(); if (t) onsend?.(t) } catch {}
  }

  function tap(d) {
    if (d.kind === 'mod') { sticky = { ...sticky, [d.mod]: !sticky[d.mod] }; return }
    if (d.kind === 'special') {
      if (d.special === 'KEYBOARD') onkeyboard?.()
      else if (d.special === 'PASTE') paste()
      clearSticky(); return
    }
    if (d.kind === 'macro') { onsend?.(macroBytes(d.macro)); clearSticky(); return }
    onsend?.(keyBytes(d.key, sticky)); clearSticky()
  }

  // Long-press → popup alt char (mirrors termux's swipe-up); a quick tap → the key.
  let pressTimer = null, didLong = false
  function down(d) {
    didLong = false
    if (d.kind === 'key' && d.popup != null) {
      pressTimer = setTimeout(() => { didLong = true; onsend?.(keyBytes(d.popup, sticky)); clearSticky() }, 380)
    }
  }
  function up(d) {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null }
    if (didLong) { didLong = false; return }
    tap(d)
  }
  const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null } didLong = false }
</script>

{#if rows.length}
  <div class="xk">
    {#each rows as row, ri (ri)}
      <div class="xk-row">
        {#each row as spec, ki (ki)}
          {@const d = describeKey(spec)}
          <!-- preventDefault on pointerdown keeps the terminal focused so the soft keyboard stays up -->
          <button type="button" class="xk-key" class:on={d.kind === 'mod' && sticky[d.mod]}
            onpointerdown={(e) => { e.preventDefault(); down(d) }}
            onpointerup={(e) => { e.preventDefault(); up(d) }}
            onpointerleave={cancel} onpointercancel={cancel}>
            {d.label}{#if d.kind === 'key' && d.popup != null}<span class="pop">{d.popup}</span>{/if}
          </button>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .xk { display: flex; flex-direction: column; gap: 3px; padding: 3px; background: #0d0e14;
    border-top: 1px solid #232433; user-select: none; -webkit-user-select: none; }
  .xk-row { display: flex; gap: 3px; }
  .xk-key { flex: 1; min-width: 0; position: relative; background: #1c1d2b; color: #c0caf5;
    border: 1px solid #2a2b3d; border-radius: 6px; padding: 8px 2px; font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1; cursor: pointer;
    touch-action: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xk-key:active { background: #2a2b3d; }
  .xk-key.on { background: #7aa2f7; color: #11121a; border-color: #7aa2f7; font-weight: 600; }
  .xk-key .pop { position: absolute; top: 1px; right: 3px; font-size: 8px; color: #565f89; }
</style>
