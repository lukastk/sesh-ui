<script>
  // Fullscreen prompt editor — a distraction-free overlay for composing a long message, shared by
  // both chat composers (HeadlessChat transcript + RpcChat). Roughly the equivalent of ⌘G / Ctrl+G
  // "edit in external editor" in claude-code: the small composer is fine for a line, this is for a
  // paragraph. Two-way binds `value` to the parent's draft so the composer and this stay in sync;
  // Esc / Done closes (keeping the draft), ⌘/Ctrl+Enter (or Send) fires the parent's send + closes.
  import { registerBack } from '../../lib/back.js'

  let { value = $bindable(''), placeholder = '', accent = '#7aa2f7', onclose, onsend } = $props()

  let ta = $state(null)
  // Always focus this editor on open — the user explicitly asked for it, so the keyboard is wanted
  // here regardless of the composer-autofocus pref. Put the caret at the end of the existing draft.
  $effect(() => { if (ta) { ta.focus(); const n = ta.value.length; ta.setSelectionRange(n, n) } })

  // Android system back closes the overlay first (consistent with the app's other overlays).
  $effect(() => registerBack(() => { onclose?.(); return true }))

  function onkey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onclose?.() }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onsend?.() }
  }
</script>

<div class="fs-backdrop" role="presentation">
  <div class="fs" role="dialog" aria-label="Expanded prompt editor">
    <div class="fs-head">
      <span class="fs-title">Prompt editor</span>
      <span class="fs-hint">⌘/Ctrl+Enter to send · Esc to close</span>
      <button class="fs-x" onclick={() => onclose?.()} aria-label="close editor">×</button>
    </div>
    <textarea bind:this={ta} bind:value {placeholder} onkeydown={onkey}></textarea>
    <div class="fs-foot">
      <button class="fs-done" onclick={() => onclose?.()}>Done</button>
      <button class="fs-send" style="background:{accent}" onclick={() => onsend?.()}>Send</button>
    </div>
  </div>
</div>

<style>
  .fs-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 80;
    display: flex; align-items: center; justify-content: center; padding: 24px; }
  .fs { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; width: 920px;
    max-width: 100%; height: 100%; max-height: 100%; display: flex; flex-direction: column;
    box-shadow: 0 12px 48px rgba(0,0,0,0.6); }
  .fs-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px;
    border-bottom: 1px solid #1f2030; }
  .fs-title { font-size: 14px; font-weight: 600; color: #c0caf5; }
  .fs-hint { flex: 1; font-size: 11px; color: #565f89; }
  .fs-x { background: none; border: 0; color: #9aa5ce; cursor: pointer; font-size: 22px; line-height: 1; padding: 0 4px; }
  .fs-x:hover { color: #c0caf5; }
  textarea { flex: 1; min-height: 0; resize: none; background: #1a1b26; color: #c0caf5;
    border: 0; padding: 16px; font-family: inherit; font-size: 15px; line-height: 1.6; outline: none; }
  .fs-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px;
    border-top: 1px solid #1f2030; }
  .fs-done { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 8px;
    padding: 7px 16px; cursor: pointer; font-size: 13px; }
  .fs-done:hover { background: #232433; }
  .fs-send { color: #16161e; border: 0; border-radius: 8px; padding: 7px 18px; font-weight: 600;
    cursor: pointer; font-size: 13px; }

  /* Phone: use the whole screen (no inset padding, square corners). */
  @media (max-width: 720px) {
    .fs-backdrop { padding: 0; }
    .fs { border-radius: 0; border: 0; }
    .fs-hint { display: none; }
  }
</style>
