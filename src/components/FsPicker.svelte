<script>
  // A home-rooted directory picker backed by GET /v1/fs/list (the daemon enumerates dirs on
  // the OWNING machine and returns ~-relative paths, so the chosen cwd is portable across a
  // cross-machine spawn — never a baked-in local home). Used by the new-thread modal.
  import { api } from '../lib/seshClient.js'

  let { value = $bindable('~'), onclose } = $props()

  let cur = $state('~')        // the ~-relative dir currently being browsed
  let entries = $state([])
  let err = $state(null)

  function parentOf(p) {
    if (p === '~' || p === '') return '~'
    const parts = p.split('/')
    parts.pop()
    return parts.join('/') || '~'
  }

  async function listDir(p) {
    try { const r = await api.fsList(p); cur = r.path; entries = r.entries || []; err = null }
    catch (e) { err = String(e) }
  }
  function choose() { value = cur; onclose?.() }

  $effect(() => { listDir(value || '~') })
</script>

<div class="backdrop" onclick={() => onclose?.()} role="presentation">
  <div class="picker" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="head">
      <button class="up" onclick={() => listDir(parentOf(cur))} disabled={cur === '~'}>↑ up</button>
      <code class="path">{cur}</code>
    </div>
    {#if err}<div class="err">{err}</div>{/if}
    <div class="list">
      {#each entries as e}
        <button class="dir" onclick={() => listDir(e.path)}>📁 {e.name}</button>
      {/each}
      {#if entries.length === 0 && !err}<div class="empty">(no subdirectories)</div>{/if}
    </div>
    <div class="actions">
      <button onclick={() => onclose?.()}>Cancel</button>
      <button class="primary" onclick={choose}>Use {cur}</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex;
    align-items: center; justify-content: center; z-index: 80; }
  .picker { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 16px;
    width: 460px; max-width: 92vw; display: flex; flex-direction: column; gap: 10px; }
  .head { display: flex; align-items: center; gap: 10px; }
  .up { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px;
    padding: 5px 10px; cursor: pointer; font-size: 12px; }
  .up:disabled { opacity: 0.4; cursor: default; }
  .path { flex: 1; font-size: 13px; color: #7aa2f7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .err { background: #3a1c28; color: #ffb4c0; border-radius: 6px; padding: 8px; font-size: 11px; }
  .list { max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;
    border: 1px solid #1f2030; border-radius: 8px; padding: 6px; }
  .dir { text-align: left; background: none; border: 0; color: #c0caf5; padding: 7px 9px;
    border-radius: 6px; cursor: pointer; font-size: 13px; }
  .dir:hover { background: #1c1d2b; }
  .empty { color: #565f89; font-size: 12px; padding: 8px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .actions button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px;
    padding: 7px 14px; cursor: pointer; font-size: 13px; }
  .actions .primary { background: #7aa2f7; color: #11121a; border: 0; font-weight: 600; }
</style>
