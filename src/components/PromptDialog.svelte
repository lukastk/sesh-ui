<script>
  // A one-field input dialog — replaces window.prompt(), which Electron does NOT support (it's a
  // silent no-op there). Enter submits, Esc / backdrop cancels.
  let { title, label = '', value = '', placeholder = '', confirmLabel = 'Save', onsubmit, oncancel } = $props()
  let v = $state(value)
  let input
  $effect(() => { input?.focus(); input?.select() })
  function submit() { onsubmit?.(v) }
  function onkey(e) { if (e.key === 'Enter') submit(); else if (e.key === 'Escape') oncancel?.() }
</script>

<div class="backdrop" onclick={oncancel} role="presentation">
  <div class="dlg" onclick={(e) => e.stopPropagation()} role="dialog">
    <h3>{title}</h3>
    {#if label}<label for="pd">{label}</label>{/if}
    <input id="pd" bind:this={input} bind:value={v} {placeholder} onkeydown={onkey} />
    <div class="actions">
      <button onclick={oncancel}>Cancel</button>
      <button class="primary" onclick={submit}>{confirmLabel}</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 85; }
  .dlg { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 18px 20px; width: 380px; max-width: 92vw; display: flex; flex-direction: column; gap: 10px; }
  h3 { margin: 0; font-size: 15px; }
  label { font-size: 12px; color: #9aa5ce; }
  input { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 9px; font-size: 14px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .actions button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 7px 16px; cursor: pointer; font-size: 13px; }
  .actions .primary { background: #7aa2f7; color: #11121a; border: 0; font-weight: 600; }
</style>
