<script>
  // A fuzzy-search picker over one cwd_root's immediate subdirs (fsList on the selected machine),
  // mirroring the Obsidian plugin's per-root FuzzySuggestModal. Entry labels come from the
  // ui_config.cwd_labels rules (applyCwdLabel). Type to filter; ↑/↓ + Enter or click to pick.
  import { api } from '../lib/seshClient.js'
  import { applyCwdLabel } from '../lib/boxlabel.js'

  let { root, machine = undefined, labels = [], onpick, onclose } = $props()

  let entries = $state([])     // [{ name, path, label }]
  let loading = $state(true)
  let err = $state(null)
  let query = $state('')
  let sel = $state(0)
  let input = $state(null)
  let listEl = $state(null)

  $effect(() => {
    api.fsList(root, machine)
      .then((r) => { entries = (r.entries || []).map((e) => ({ name: e.name, path: e.path, label: applyCwdLabel(e.name, e.path, labels) })); loading = false })
      .catch((e) => { err = String(e); loading = false })
  })
  $effect(() => { input?.focus() })

  // Subsequence fuzzy score (lower = better; Infinity = no match): the query's chars must appear in
  // order; earlier first-hit and tighter gaps rank higher.
  function score(q, text) {
    if (!q) return 0
    const t = text.toLowerCase()
    let ti = 0, first = -1, gaps = 0
    for (const ch of q.toLowerCase()) {
      const idx = t.indexOf(ch, ti)
      if (idx < 0) return Infinity
      if (first < 0) first = idx
      if (ti > 0 && idx > ti) gaps += idx - ti
      ti = idx + 1
    }
    return first + gaps
  }
  let filtered = $derived.by(() => {
    const q = query.trim()
    return entries
      .map((e) => ({ e, s: Math.min(score(q, e.label), score(q, e.name)) }))
      .filter((x) => x.s !== Infinity)
      .sort((a, b) => a.s - b.s || a.e.label.localeCompare(b.e.label))
      .map((x) => x.e)
  })
  $effect(() => { void filtered; sel = 0 })
  // keep the highlighted row visible
  $effect(() => { void sel; listEl?.querySelector('.fz-item.on')?.scrollIntoView({ block: 'nearest' }) })

  function pick(e) { onpick?.(e.path); onclose?.() }
  function onkey(ev) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1) }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); sel = Math.max(sel - 1, 0) }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (filtered[sel]) pick(filtered[sel]) }
    else if (ev.key === 'Escape') { ev.preventDefault(); onclose?.() }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="fz" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="fz-head">
      <input bind:this={input} bind:value={query} placeholder={`filter ${root}…`} onkeydown={onkey} />
      <button class="fz-x" onclick={onclose} aria-label="close">×</button>
    </div>
    {#if err}<div class="fz-err">{err}</div>{/if}
    <div class="fz-list" bind:this={listEl}>
      {#if loading}<div class="fz-msg">loading…</div>{/if}
      {#each filtered as e, i (e.path)}
        <button class="fz-item" class:on={i === sel} onmouseenter={() => (sel = i)} onclick={() => pick(e)} title={e.path}>
          {e.label}
        </button>
      {/each}
      {#if !loading && filtered.length === 0}<div class="fz-msg">{entries.length ? 'no matches' : '(nothing checked out here)'}</div>{/if}
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: flex-start;
    justify-content: center; z-index: 85; padding-top: 9vh; }
  .fz { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; width: 480px; max-width: 92vw;
    display: flex; flex-direction: column; gap: 8px; padding: 12px; box-shadow: 0 16px 48px rgba(0,0,0,0.6); }
  .fz-head { display: flex; gap: 8px; align-items: center; }
  .fz-head input { flex: 1; background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px;
    padding: 9px 11px; font-size: 14px; }
  .fz-x { background: none; border: 0; color: #9aa5ce; cursor: pointer; font-size: 18px; line-height: 1; padding: 0 4px; }
  .fz-err { background: #3a1c28; color: #ffb4c0; border-radius: 6px; padding: 8px; font-size: 11px; word-break: break-word; }
  .fz-list { max-height: 46vh; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 1px; }
  .fz-item { text-align: left; background: none; border: 0; color: #c0caf5; padding: 8px 11px; border-radius: 6px;
    cursor: pointer; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fz-item.on { background: #1e3a4a; }
  .fz-msg { color: #565f89; font-size: 12px; padding: 8px 11px; }
</style>
