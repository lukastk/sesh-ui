<script>
  // A confirm dialog — replaces window.confirm() with an in-app modal (consistent styling, and
  // guaranteed behavior across web and Electron). Enter confirms, Esc / backdrop cancels.
  let { title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = false, onconfirm, oncancel } = $props()
  function onkey(e) { if (e.key === 'Enter') onconfirm?.(); else if (e.key === 'Escape') oncancel?.() }
  $effect(() => { window.addEventListener('keydown', onkey); return () => window.removeEventListener('keydown', onkey) })
</script>

<div class="backdrop" onclick={oncancel} role="presentation">
  <div class="dlg" onclick={(e) => e.stopPropagation()} role="dialog">
    <h3>{title}</h3>
    {#if message}<p>{message}</p>{/if}
    <div class="actions">
      <button onclick={oncancel}>Cancel</button>
      <button class:danger class:primary={!danger} onclick={onconfirm}>{confirmLabel}</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 85; }
  .dlg { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 18px 20px; width: 400px; max-width: 92vw; display: flex; flex-direction: column; gap: 10px; }
  h3 { margin: 0; font-size: 15px; }
  p { margin: 0; font-size: 13px; color: #9aa5ce; line-height: 1.5; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .actions button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 7px 16px; cursor: pointer; font-size: 13px; }
  .actions .primary { background: #7aa2f7; color: #11121a; border: 0; font-weight: 600; }
  .actions .danger { background: #f7768e; color: #11121a; border: 0; font-weight: 600; }
</style>
