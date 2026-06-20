<script>
  // Reusable context menu. Open it by setting `{ x, y, items }` state in a parent and rendering
  //   {#if menu}<ContextMenu {...menu} onclose={() => (menu = null)} />{/if}
  // Triggered on desktop by `oncontextmenu` (right-click); the Android long-press trigger (separate
  // branch) opens the SAME component with the touch coords — so the interface is just data:
  //   items: Array<{ label, onselect, danger?, disabled? } | { separator: true }>
  //   x, y:  viewport coords (clientX/clientY); the menu clamps itself on-screen
  //   onclose: called on Esc / outside-click / after a selection
  import { tick } from 'svelte'

  let { items = [], x = 0, y = 0, onclose } = $props()

  let el = $state(null)
  let pos = $state(null)   // set once measured; until then the template falls back to the raw x/y

  // Clamp into the viewport once measured (so a near-edge open doesn't overflow).
  $effect(() => {
    tick().then(() => {
      if (!el) return
      const r = el.getBoundingClientRect()
      pos = {
        left: Math.max(6, Math.min(x, window.innerWidth - r.width - 6)),
        top: Math.max(6, Math.min(y, window.innerHeight - r.height - 6)),
      }
    })
  })

  function choose(it) {
    if (it.disabled || it.separator) return
    onclose?.()
    it.onselect?.()
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); onclose?.() } }
</script>

<svelte:window onkeydown={onKey} onresize={() => onclose?.()} />

<!-- full-screen backdrop catches an outside click / a second right-click to close -->
<div class="cm-backdrop" onpointerdown={() => onclose?.()} oncontextmenu={(e) => { e.preventDefault(); onclose?.() }} role="presentation">
  <div class="cm" bind:this={el} style="left:{pos?.left ?? x}px; top:{pos?.top ?? y}px"
    onpointerdown={(e) => e.stopPropagation()} role="menu" tabindex="-1">
    {#each items as it, i (i)}
      {#if it.separator}
        <div class="cm-sep"></div>
      {:else}
        <button class="cm-item" class:danger={it.danger} disabled={it.disabled}
          role="menuitem" onclick={() => choose(it)}>{it.label}</button>
      {/if}
    {/each}
  </div>
</div>

<style>
  .cm-backdrop { position: fixed; inset: 0; z-index: 90; }
  .cm { position: fixed; min-width: 184px; max-width: 280px; background: #16161e; border: 1px solid #2a2b3d;
    border-radius: 9px; padding: 5px; box-shadow: 0 10px 32px rgba(0,0,0,0.55); display: flex; flex-direction: column; gap: 1px; }
  .cm-item { text-align: left; background: none; border: 0; color: #c0caf5; padding: 7px 11px; border-radius: 6px;
    font-size: 13px; cursor: pointer; white-space: nowrap; }
  .cm-item:hover:not(:disabled) { background: #1c1d2b; }
  .cm-item.danger { color: #ffb4c0; }
  .cm-item:disabled { opacity: 0.4; cursor: default; }
  .cm-sep { height: 1px; background: #232433; margin: 4px 2px; }
</style>
