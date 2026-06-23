<script>
  // Connection settings: which daemon to talk to (local unix socket / remote host:port + token)
  // and the token. The token is WRITE-ONLY — getConfig never returns its value, only whether one
  // is set; we send a new token only if the user types one. In web/dev the endpoint is the fixed
  // Vite proxy (read-only). On save, the Electron main process rebuilds its transport and reloads.
  import { sesh, api } from '../lib/seshClient.js'
  import { pushError, pushInfo } from '../lib/toasts.svelte.js'
  import { startTranscriptPrefetch } from '../lib/transcriptCache.js'
  import { KEYMAP_DEFS, keymap, setBinding, resetBinding, resetAllBindings, fmtCombo, comboFromEvent } from '../lib/keymap.svelte.js'

  let { onclose } = $props()

  // Keyboard shortcuts: click a binding to rebind, then press the new combo (Esc cancels). The
  // capture listener runs in the CAPTURE phase + stops propagation so the chord we're recording
  // never also fires its own action (e.g. cmd+1 rebinding wouldn't switch screens).
  let capturing = $state(null)   // action id being rebound, or null
  $effect(() => {
    if (!capturing) return
    const handler = (e) => {
      e.preventDefault(); e.stopImmediatePropagation()
      if (e.key === 'Escape') { capturing = null; return }
      const combo = comboFromEvent(e)
      if (!combo) return           // bare modifier — keep waiting for the real key
      setBinding(capturing, combo); capturing = null
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  })
  // Group the catalog by scope for display, preserving catalog order.
  const keymapGroups = (() => {
    const groups = []
    for (const def of KEYMAP_DEFS) {
      let g = groups.find((x) => x.scope === def.scope)
      if (!g) { g = { scope: def.scope, defs: [] }; groups.push(g) }
      g.defs.push(def)
    }
    return groups
  })()

  let cfg = $state(null)        // { mode, target, hasToken, editable }
  // Per-daemon UI config (served from <SESH_HOME>/ui_config.toml on the connected daemon, schema ≥24).
  let uiCfg = $state(null)      // { collapse_parents, … }
  let uiUnsupported = $state(false)
  $effect(() => {
    api.uiConfigGet()
      .then((r) => { uiCfg = r.ui_config || {} })
      .catch((e) => { if (/:\s*404/.test(String(e))) uiUnsupported = true; else pushError(e) })
  })
  let newRoot = $state('')
  // Mesh machines for the "default machine" dropdown (connected + dial-able peers).
  let machines = $state([])
  let connectedMachine = $state(null)
  $effect(() => {
    sesh.peerInfo().then((i) => { connectedMachine = i.connected; machines = [i.connected, ...(i.peers || [])].filter(Boolean) }).catch(() => {})
  })
  // POST is a full REPLACE (an absent key resets to default), so always send the WHOLE config —
  // merge the patch over ALL current values so changing one setting never clobbers another (incl.
  // cwd_labels and transcript_prefetch_secs, which would otherwise reset when toggling e.g. collapse).
  async function saveUiConfig(patch) {
    const next = {
      collapse_parents: uiCfg.collapse_parents,
      cwd_roots: uiCfg.cwd_roots || [],
      cwd_labels: uiCfg.cwd_labels || [],
      transcript_prefetch_secs: uiCfg.transcript_prefetch_secs ?? 10,
      master_command: uiCfg.master_command ?? '',
      // New-thread defaults — only sent when the daemon exposes them (the POST decodes strictly, so
      // sending a field a pre-default_* daemon doesn't know would 400 every save). Once present, the
      // full-replace contract requires echoing them back so they aren't reset.
      ...(uiCfg.default_agent !== undefined ? { default_agent: uiCfg.default_agent } : {}),
      ...(uiCfg.default_machine !== undefined ? { default_machine: uiCfg.default_machine } : {}),
      // Default chat view (terminal | transcript | rpc) — same full-replace echo contract: only sent
      // when the daemon exposes it, so a save never resets the user's choice (and never 400s a
      // pre-default_chat_view daemon).
      ...(uiCfg.default_chat_view !== undefined ? { default_chat_view: uiCfg.default_chat_view } : {}),
      ...patch,
    }
    try {
      // next embeds uiCfg.cwd_roots / cwd_labels, which are Svelte $state PROXIES (uiCfg is $state,
      // and nested arrays/objects are deeply proxied). The Electron transport (window.sesh.post →
      // contextBridge) structured-clones the body, and a Proxy is not cloneable → "An object could
      // not be cloned." Snapshot to a plain deep clone before it crosses the IPC boundary. (Web mode
      // JSON-stringifies, so this only bit the Electron app.)
      const r = await api.uiConfigSet($state.snapshot(next)); uiCfg = r.ui_config; pushInfo('UI config saved')
      startTranscriptPrefetch(uiCfg.transcript_prefetch_secs ?? 10)   // apply a changed interval live
    }
    catch (e) { pushError(`ui-config: ${e.message ?? e}`); uiCfg = { ...uiCfg } } // revert the controls
  }
  const setCollapseParents = (v) => saveUiConfig({ collapse_parents: v })
  // New-thread defaults (ui_config.default_agent / default_machine; '' machine = "the connected one").
  const setDefaultAgent = (v) => saveUiConfig({ default_agent: v })
  const setDefaultMachine = (v) => saveUiConfig({ default_machine: v })
  // Default chat view a thread opens on (terminal | transcript | rpc; daemon-side schema gated).
  const setDefaultChatView = (v) => saveUiConfig({ default_chat_view: v })
  // transcript_prefetch_secs: clamp to a non-negative int; '' / NaN → 0 (off).
  function setPrefetchSecs(v) {
    const n = Math.max(0, Math.floor(Number(v)))
    saveUiConfig({ transcript_prefetch_secs: Number.isFinite(n) ? n : 0 })
  }
  // master_command: the shell command the Master screen runs in a pty (e.g. "mmt-start"). Empty = the
  // master endpoint is disabled on this daemon (the Master screen shows a "not configured" notice).
  const setMasterCommand = (v) => saveUiConfig({ master_command: v.trim() })
  function addRoot() {
    const r = newRoot.trim()
    if (!r) return
    if ((uiCfg.cwd_roots || []).includes(r)) { newRoot = ''; return }
    newRoot = ''
    saveUiConfig({ cwd_roots: [...(uiCfg.cwd_roots || []), r] })
  }
  const removeRoot = (r) => saveUiConfig({ cwd_roots: (uiCfg.cwd_roots || []).filter((x) => x !== r) })

  // cwd_labels: match→label regex rules. Edited inline (saved on blur); the daemon validates each on
  // save and a bad regex surfaces as its loud 400 (pushError shows the body). Add via the form below.
  let newMatch = $state('')
  let newLabel = $state('')
  function updateRule(i, field, value) {
    const rules = (uiCfg.cwd_labels || []).map((r, j) => (j === i ? { ...r, [field]: value } : r))
    saveUiConfig({ cwd_labels: rules })
  }
  const removeRule = (i) => saveUiConfig({ cwd_labels: (uiCfg.cwd_labels || []).filter((_, j) => j !== i) })
  function addRule() {
    if (!newMatch.trim()) return
    const rule = { match: newMatch.trim(), label: newLabel }
    newMatch = ''; newLabel = ''
    saveUiConfig({ cwd_labels: [...(uiCfg.cwd_labels || []), rule] })
  }
  let mode = $state('local')
  let socketPath = $state('')
  let host = $state('')
  let port = $state('')
  let token = $state('')
  let saving = $state(false)

  $effect(() => {
    sesh.getConfig().then((c) => {
      cfg = c
      if (c.mode === 'remote') {
        mode = 'remote'
        const [h, p] = (c.target || '').split(':')
        host = h || ''; port = p || ''
      } else if (c.mode === 'local') {
        mode = 'local'; socketPath = c.target || ''
      }
    }).catch((e) => pushError(e))
  })

  async function save() {
    saving = true
    try {
      const input = mode === 'remote'
        ? { mode: 'remote', host: host.trim(), port: port.trim(), ...(token ? { token } : {}) }
        : { mode: 'local', socketPath: socketPath.trim() }
      await sesh.setConfig(input)
      onclose?.()
    } catch (e) { pushError(e); saving = false }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
    <h3>Connection</h3>
    {#if cfg && !cfg.editable}
      <div class="readonly">
        <div class="kv"><span>transport</span><b>{sesh.transport}</b></div>
        <div class="kv"><span>endpoint</span><b>{cfg.target}</b></div>
        <p class="note">The endpoint is fixed in web/dev mode — it's the Vite proxy (see <code>vite.config.js</code>). The Electron app lets you set a local socket or a remote host + token here.</p>
      </div>
    {:else if cfg}
      <label>Endpoint
        <div class="seg">
          <button class:on={mode === 'local'} onclick={() => (mode = 'local')}>Local socket</button>
          <button class:on={mode === 'remote'} onclick={() => (mode = 'remote')}>Remote (TCP)</button>
        </div>
      </label>

      {#if mode === 'local'}
        <label>Socket path <input bind:value={socketPath} placeholder="~/.sesh/daemon.sock" /></label>
        <p class="note">A local daemon's unix socket — no token needed (local trust).</p>
      {:else}
        <div class="hp">
          <label class="grow">Host <input bind:value={host} placeholder="mymain or 100.x.y.z" /></label>
          <label>Port <input bind:value={port} placeholder="7878" /></label>
        </div>
        <label>Token
          <input type="password" bind:value={token} placeholder={cfg.hasToken ? '•••••• (unchanged — type to replace)' : 'SESH_API_TOKEN'} />
        </label>
        <p class="note">The bearer token is held only in the main process (encrypted at rest) — never in this window.</p>
      {/if}

      <div class="actions">
        <button onclick={onclose}>Cancel</button>
        <button class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save & reconnect'}</button>
      </div>
    {:else}
      <div class="readonly">loading…</div>
    {/if}

    <hr class="sep" />
    <h3>UI <span class="sub">· {cfg?.target || 'this daemon'}</span></h3>
    {#if uiUnsupported}
      <p class="note">UI config needs a daemon on schema ≥24. This daemon predates it.</p>
    {:else if uiCfg}
      <label class="check">
        <input type="checkbox" checked={uiCfg.collapse_parents} onchange={(e) => setCollapseParents(e.currentTarget.checked)} />
        Collapse parent threads by default
      </label>

      {#if uiCfg.default_agent !== undefined}
        <label class="ddl">New-thread default agent
          <select value={uiCfg.default_agent || 'pi'} onchange={(e) => setDefaultAgent(e.currentTarget.value)}>
            {#each ['pi', 'claude', 'codex'] as a}<option value={a}>{a}</option>{/each}
          </select>
        </label>
      {/if}
      {#if uiCfg.default_machine !== undefined}
        <label class="ddl">New-thread default machine
          <select value={uiCfg.default_machine || ''} onchange={(e) => setDefaultMachine(e.currentTarget.value)}>
            <option value="">(the machine you're connected to)</option>
            {#each machines as m (m)}<option value={m}>{m}{m === connectedMachine ? ' (this)' : ''}</option>{/each}
          </select>
        </label>
      {/if}
      {#if uiCfg.default_chat_view !== undefined}
        <label class="ddl">Default chat view
          <select value={uiCfg.default_chat_view || 'terminal'} onchange={(e) => setDefaultChatView(e.currentTarget.value)}>
            <option value="terminal">Terminal</option>
            <option value="transcript">Transcript</option>
            <option value="rpc">RPC (pi)</option>
          </select>
        </label>
      {/if}
      {#if uiCfg.default_agent === undefined}
        <p class="note">The new-thread default agent/machine controls appear here once the connected daemon exposes them (needs <code>default_agent</code> / <code>default_machine</code> in UIConfig).</p>
      {/if}

      {#if uiCfg.transcript_prefetch_secs !== undefined}
        <label class="prefetch">
          Transcript prefetch interval (seconds, 0 = off)
          <input type="number" min="0" step="1" value={uiCfg.transcript_prefetch_secs}
            onchange={(e) => setPrefetchSecs(e.currentTarget.value)} />
        </label>
        <p class="note">The app silently prefetches every non-archived thread's transcript on this interval and caches it, so opening a thread's transcript is instant. 0 disables it.</p>
      {/if}

      {#if uiCfg.master_command !== undefined}
        <label class="mastercmd">
          Master command (Master tab; e.g. mmt-start)
          <input value={uiCfg.master_command} placeholder="(unset — Master tab disabled)"
            onchange={(e) => setMasterCommand(e.currentTarget.value)} />
        </label>
        <p class="note">The shell command the <b>Master</b> tab runs in a pty to attach this machine's master tmux cockpit. Runs via <code>$SHELL -ic</code> so functions/aliases resolve. Empty disables the Master endpoint on this daemon.</p>
      {/if}

      {#if uiCfg.cwd_roots !== undefined}
        <div class="roots">
          <span class="roots-label">New-thread folders (cwd_roots)</span>
          {#each uiCfg.cwd_roots as r (r)}
            <div class="root"><code>{r}</code><button class="rm" onclick={() => removeRoot(r)} aria-label="remove {r}">×</button></div>
          {/each}
          {#if uiCfg.cwd_roots.length === 0}<div class="root-empty">(none)</div>{/if}
          <div class="addroot">
            <input bind:value={newRoot} placeholder="~/path" onkeydown={(e) => e.key === 'Enter' && addRoot()} />
            <button onclick={addRoot} disabled={!newRoot.trim()}>Add</button>
          </div>
        </div>
      {/if}

      {#if uiCfg.cwd_labels !== undefined}
        <div class="roots">
          <span class="roots-label">Folder label rules (cwd_labels)</span>
          {#each uiCfg.cwd_labels as rule, i (i)}
            <div class="rule">
              <input class="r-match" value={rule.match} placeholder="^~/dev/…(?P&lt;boxid&gt;…)__(?P&lt;boxname&gt;…)$"
                onchange={(e) => updateRule(i, 'match', e.currentTarget.value)} />
              <input class="r-label" value={rule.label} placeholder="{'{boxname} <{boxid}>'}"
                onchange={(e) => updateRule(i, 'label', e.currentTarget.value)} />
              <button class="rm" onclick={() => removeRule(i)} aria-label="remove rule {i + 1}">×</button>
            </div>
          {/each}
          {#if uiCfg.cwd_labels.length === 0}<div class="root-empty">(none — entries show raw names)</div>{/if}
          <div class="addrule">
            <input class="r-match" bind:value={newMatch} placeholder="match regex (Go RE2, ?P&lt;name&gt;)" />
            <input class="r-label" bind:value={newLabel} placeholder="label template" />
            <button onclick={addRule} disabled={!newMatch.trim()}>Add</button>
          </div>
        </div>
      {/if}
      <p class="note">Per-daemon UI preferences, stored on the connected daemon (<code>~/.sesh/ui_config.toml</code>). The label rules format new-thread picker entries (first matching regex wins; template uses named groups + <code>{'{name}'}</code>/<code>{'{path}'}</code>). A bad regex is rejected by the daemon.</p>
    {:else}
      <p class="note">loading…</p>
    {/if}

    <hr class="sep" />
    <div class="km-head">
      <h3>Keyboard shortcuts</h3>
      <button class="km-resetall" onclick={resetAllBindings}>Reset all</button>
    </div>
    {#each keymapGroups as g (g.scope)}
      <div class="km-group">
        <span class="km-scope">{g.scope}</span>
        {#each g.defs as def (def.id)}
          <div class="km-row">
            <span class="km-label">{def.label}</span>
            <button class="km-bind" class:capturing={capturing === def.id}
              onclick={() => (capturing = capturing === def.id ? null : def.id)}>
              {capturing === def.id ? 'press keys…' : fmtCombo(keymap[def.id])}
            </button>
            {#if keymap[def.id] !== def.default}
              <button class="km-reset" title="reset to {fmtCombo(def.default)}" onclick={() => resetBinding(def.id)} aria-label="reset {def.label}">↺</button>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
    <p class="note">Stored locally in this app. <b>mod</b> = ⌘ on macOS, Ctrl elsewhere. The Threads/Tickets shortcuts apply on their own screen (so <b>{fmtCombo('mod+n')}</b> is new-thread or new-ticket depending on where you are).</p>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 90; }
  .modal { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 20px 22px; width: 420px; max-width: 92vw; display: flex; flex-direction: column; gap: 12px;
    /* The settings panel (Connection + UI config + cwd roots/labels + keyboard shortcuts) is taller
       than the viewport — cap it and scroll internally, or the bottom rows are unreachable. */
    max-height: 90vh; overflow-y: auto; }
  h3 { margin: 0 0 2px; font-size: 16px; }
  h3 .sub { font-size: 11px; color: #565f89; font-weight: 400; }
  .sep { width: 100%; border: 0; border-top: 1px solid #1f2030; margin: 4px 0; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #9aa5ce; }
  .check { flex-direction: row; align-items: center; gap: 8px; color: #c0caf5; font-size: 13px; }
  .prefetch input { width: 90px; }
  .ddl select { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px;
    padding: 7px 8px; font-size: 13px; font-family: inherit; }
  .mastercmd input { font-family: ui-monospace, monospace; font-size: 12px; }
  .roots { display: flex; flex-direction: column; gap: 4px; }
  .roots-label { font-size: 11px; color: #565f89; }
  .root { display: flex; align-items: center; gap: 8px; background: #1a1b26; border: 1px solid #232433;
    border-radius: 6px; padding: 4px 9px; }
  .root code { flex: 1; color: #7dcfff; font-size: 12px; }
  .root .rm { background: none; border: 0; color: #ffb4c0; cursor: pointer; font-size: 15px; line-height: 1; padding: 0 2px; }
  .root-empty { font-size: 11px; color: #565f89; }
  .addroot { display: flex; gap: 6px; }
  .addroot input { flex: 1; background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px; padding: 5px 9px; font-size: 12px; }
  .addroot button, .addrule button { background: #2a2b3d; color: #c0caf5; border: 0; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
  .addroot button:disabled, .addrule button:disabled { opacity: 0.4; }
  .rule, .addrule { display: flex; align-items: center; gap: 6px; }
  .rule input, .addrule input { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 6px;
    padding: 5px 8px; font-size: 11px; font-family: ui-monospace, monospace; min-width: 0; }
  .r-match { flex: 2; } .r-label { flex: 1; }
  input { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 8px; font-size: 13px; font-family: inherit; }
  .seg { display: flex; border: 1px solid #2a2b3d; border-radius: 7px; overflow: hidden; }
  .seg button { flex: 1; border: 0; background: #1a1b26; color: #9aa5ce; padding: 7px; font-size: 13px; cursor: pointer; }
  .seg button.on { background: #7aa2f7; color: #11121a; font-weight: 600; }
  .hp { display: flex; gap: 8px; } .hp .grow { flex: 1; } .hp label:not(.grow) input { width: 80px; }
  .note { margin: 0; font-size: 11px; color: #565f89; line-height: 1.4; }
  .readonly { display: flex; flex-direction: column; gap: 8px; }
  .kv { display: flex; justify-content: space-between; font-size: 13px; color: #9aa5ce; }
  .kv b { color: #c0caf5; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .actions button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px; padding: 7px 16px; cursor: pointer; font-size: 13px; }
  .actions .primary { background: #7aa2f7; color: #11121a; border: 0; font-weight: 600; }
  .actions button:disabled { opacity: 0.5; }
  code { color: #7aa2f7; }

  .km-head { display: flex; align-items: center; justify-content: space-between; }
  .km-resetall { background: #1a1b26; color: #9aa5ce; border: 1px solid #2a2b3d; border-radius: 6px;
    padding: 4px 10px; font-size: 11px; cursor: pointer; }
  .km-resetall:hover { background: #232433; color: #c0caf5; }
  .km-group { display: flex; flex-direction: column; gap: 4px; }
  .km-scope { font-size: 10px; color: #565f89; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
  .km-row { display: flex; align-items: center; gap: 8px; }
  .km-label { flex: 1; font-size: 12px; color: #c0caf5; }
  .km-bind { min-width: 72px; text-align: center; background: #1a1b26; color: #7dcfff; border: 1px solid #2a2b3d;
    border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: ui-monospace, monospace; }
  .km-bind:hover { background: #232433; }
  .km-bind.capturing { color: #e0af68; border-color: #e0af68; font-family: inherit; }
  .km-reset { background: none; border: 0; color: #565f89; cursor: pointer; font-size: 13px; padding: 0 2px; }
  .km-reset:hover { color: #c0caf5; }
</style>
