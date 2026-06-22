<script>
  // A fuzzy-search picker over one cwd_root's immediate subdirs, mirroring the Obsidian plugin's
  // per-root FuzzySuggestModal. Type to filter; ↑/↓ + Enter or click to pick.
  //
  // Two sources, in priority order:
  //   1. A daemon PLUGIN (schema ≥29) whose list capability is rooted at this folder — e.g.
  //      boxyard's `boxes`. It returns rich entries {id,label,groups,path}, so we render the full
  //      mysystem-style "name [groups]" and can fuzzy-match on the groups too. If that same plugin
  //      also exposes an action capability (e.g. create-box), we surface it as a "+ new" form.
  //   2. Fallback: the raw fs/list (subdir names through ui_config.cwd_labels), exactly as before,
  //      when no plugin matches this root (or the daemon predates the plugin substrate).
  import { api } from '../lib/seshClient.js'
  import { applyCwdLabel } from '../lib/boxlabel.js'

  let { root, machine = undefined, labels = [], onpick, onclose } = $props()

  let entries = $state([])     // [{ path, label, groups, search }]
  let loading = $state(true)
  let err = $state(null)
  let query = $state('')
  let sel = $state(0)
  let input = $state(null)
  let listEl = $state(null)

  // The plugin matched to this root (if any) + its capabilities.
  let plugin = $state(null)
  let listCap = $state(null)
  let actionCap = $state(null)
  // The create-action form.
  let showCreate = $state(false)
  let createVals = $state({})
  let creating = $state(false)
  let createErr = $state(null)

  const actionLabel = $derived(actionCap ? actionCap.name.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '')

  // A list capability "belongs" to this root when its mapped path template lives under it
  // (boxyard `boxes` maps to "~/dev/{…}", so it matches root "~/dev"). The first match wins; we
  // also grab a sibling action capability from the SAME plugin for the create affordance.
  function matchPlugin(plugins) {
    for (const p of plugins || []) {
      const lc = (p.capabilities || []).find(
        (c) => c.kind === 'list' && typeof c.map?.path === 'string' && c.map.path.startsWith(root + '/'),
      )
      if (lc) return { plugin: p, listCap: lc, actionCap: (p.capabilities || []).find((c) => c.kind === 'action') || null }
    }
    return null
  }

  async function loadEntries(m) {
    loading = true; err = null
    try {
      if (listCap) {
        const r = await api.pluginRun(plugin.name, listCap.name, {}, m)
        entries = (r.items || []).map((it) => ({
          path: it.path, label: it.label, groups: it.groups || [],
          search: [it.label, (it.groups || []).join(' '), it.id].join(' '),
        }))
      } else {
        const r = await api.fsList(root, m)
        entries = (r.entries || []).map((e) => {
          const label = applyCwdLabel(e.name, e.path, labels)
          return { path: e.path, label, groups: [], search: label + ' ' + e.name }
        })
      }
    } catch (e) { err = String(e) }
    finally { loading = false }
  }

  $effect(() => {
    const m = machine   // track: refetch if the target machine changes while open
    api.plugins(m)
      .then((r) => { const x = matchPlugin(r.plugins); plugin = x?.plugin || null; listCap = x?.listCap || null; actionCap = x?.actionCap || null })
      .catch(() => { /* old daemon / no plugin substrate → fall back to fs/list below */ })
      .then(() => loadEntries(m))
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
      .map((e) => ({ e, s: score(q, e.search) }))
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

  function openCreate() {
    createErr = null
    createVals = Object.fromEntries((actionCap.fields || []).map((f) => [f.name, '']))
    showCreate = true
  }
  async function submitCreate() {
    if (creating) return
    const missing = (actionCap.fields || []).filter((f) => f.required && !String(createVals[f.name] ?? '').trim())
    if (missing.length) { createErr = `required: ${missing.map((f) => f.label || f.name).join(', ')}`; return }
    creating = true; createErr = null
    try {
      await api.pluginRun(plugin.name, actionCap.name, createVals, machine)
      const created = String(createVals[(actionCap.fields?.[0]?.name) || 'name'] ?? '').trim()
      showCreate = false
      await loadEntries(machine)   // refresh so the new entry appears
      query = created              // and filter to it so it surfaces at the top
    } catch (e) { createErr = String(e) }
    finally { creating = false }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="fz" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="fz-head">
      <input bind:this={input} bind:value={query} placeholder={`filter ${root}…`} onkeydown={onkey} />
      {#if actionCap}
        <button class="fz-new" onclick={openCreate} title={actionCap.description || actionLabel}>+ {actionLabel}</button>
      {/if}
      <button class="fz-x" onclick={onclose} aria-label="close">×</button>
    </div>
    {#if err}<div class="fz-err">{err}</div>{/if}
    {#if showCreate}
      <form class="fz-create" onsubmit={(e) => { e.preventDefault(); submitCreate() }}>
        {#each actionCap.fields || [] as f (f.name)}
          <label class="fz-field">
            <span>{f.label || f.name}{#if f.required}<span class="req"> *</span>{/if}</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input type={f.type === 'number' ? 'number' : 'text'} bind:value={createVals[f.name]}
              autofocus={f.name === (actionCap.fields?.[0]?.name)} disabled={creating} />
          </label>
        {/each}
        {#if createErr}<div class="fz-err">{createErr}</div>{/if}
        <div class="fz-create-actions">
          <button type="button" class="ghost" onclick={() => (showCreate = false)} disabled={creating}>Cancel</button>
          <button type="submit" class="primary" disabled={creating}>{creating ? 'Creating…' : actionLabel}</button>
        </div>
      </form>
    {/if}
    <div class="fz-list" bind:this={listEl}>
      {#if loading}<div class="fz-msg">loading…</div>{/if}
      {#each filtered as e, i (e.path)}
        <button class="fz-item" class:on={i === sel} onmouseenter={() => (sel = i)} onclick={() => pick(e)} title={e.path}>
          <span class="bx-name">{e.label}</span>
          {#if e.groups.length}<span class="bx-groups">{#each e.groups as g}<span class="bx-grp">{g}</span>{/each}</span>{/if}
        </button>
      {/each}
      {#if !loading && filtered.length === 0}<div class="fz-msg">{entries.length ? 'no matches' : '(nothing checked out here)'}</div>{/if}
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: flex-start;
    justify-content: center; z-index: 85; padding-top: 9vh; }
  .fz { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; width: 520px; max-width: 92vw;
    display: flex; flex-direction: column; gap: 8px; padding: 12px; box-shadow: 0 16px 48px rgba(0,0,0,0.6); }
  .fz-head { display: flex; gap: 8px; align-items: center; }
  .fz-head input { flex: 1; background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px;
    padding: 9px 11px; font-size: 14px; }
  .fz-new { background: #1e3a2a; color: #9ece6a; border: 1px solid #2a4a35; border-radius: 7px;
    padding: 8px 11px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .fz-new:hover { background: #244833; }
  .fz-x { background: none; border: 0; color: #9aa5ce; cursor: pointer; font-size: 18px; line-height: 1; padding: 0 4px; }
  .fz-err { background: #3a1c28; color: #ffb4c0; border-radius: 6px; padding: 8px; font-size: 12px; word-break: break-word; }
  .fz-create { display: flex; flex-direction: column; gap: 8px; background: #14140f; border: 1px solid #2a4a35;
    border-radius: 8px; padding: 11px; }
  .fz-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #9aa5ce; }
  .fz-field .req { color: #f7768e; }
  .fz-field input { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px;
    padding: 8px 10px; font-size: 14px; }
  .fz-create-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .fz-create-actions button { border: 0; border-radius: 7px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .fz-create-actions .ghost { background: #1a1b26; color: #9aa5ce; border: 1px solid #2a2b3d; }
  .fz-create-actions .primary { background: #9ece6a; color: #14140f; }
  .fz-create-actions button:disabled { opacity: 0.5; cursor: default; }
  .fz-list { max-height: 52vh; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 2px; }
  /* flex: 0 0 auto is load-bearing: without it the rows are flex children that SHRINK to fit the
     fixed-height column (hundreds of boxes → each crushed to ~16px, text clipped) instead of scrolling. */
  .fz-item { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; text-align: left; background: none;
    border: 0; color: #c0caf5; font: inherit; font-size: 14px; line-height: 1.45; padding: 9px 12px;
    border-radius: 6px; cursor: pointer; }
  .fz-item:hover { background: #1c1d2b; }
  .fz-item.on { background: #2d4f63; color: #fff; }
  .bx-name { flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bx-groups { flex: 0 0 auto; display: flex; gap: 4px; margin-left: auto; }
  .bx-grp { background: #1a2733; color: #7dcfff; border: 1px solid #1e3a4a; border-radius: 5px;
    padding: 1px 6px; font-size: 11px; white-space: nowrap; }
  .fz-item.on .bx-grp { background: #234155; color: #b8e6ff; }
  .fz-msg { color: #565f89; font-size: 13px; padding: 8px 11px; }
</style>
