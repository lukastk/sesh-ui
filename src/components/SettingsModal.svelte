<script>
  // Connection settings: which daemon to talk to (local unix socket / remote host:port + token)
  // and the token. The token is WRITE-ONLY — getConfig never returns its value, only whether one
  // is set; we send a new token only if the user types one. In web/dev the endpoint is the fixed
  // Vite proxy (read-only). On save, the Electron main process rebuilds its transport and reloads.
  import { sesh, api } from '../lib/seshClient.js'
  import { pushError, pushInfo } from '../lib/toasts.svelte.js'

  let { onclose } = $props()

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
  // POST is a full REPLACE (an absent key resets to default), so always send the WHOLE config —
  // merge the patch over the current values so changing one setting never clobbers another.
  async function saveUiConfig(patch) {
    const next = { collapse_parents: uiCfg.collapse_parents, cwd_roots: uiCfg.cwd_roots || [], ...patch }
    try { const r = await api.uiConfigSet(next); uiCfg = r.ui_config; pushInfo('UI config saved') }
    catch (e) { pushError(`ui-config: ${e.message ?? e}`); uiCfg = { ...uiCfg } } // revert the controls
  }
  const setCollapseParents = (v) => saveUiConfig({ collapse_parents: v })
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
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 90; }
  .modal { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 20px 22px; width: 420px; max-width: 92vw; display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0 0 2px; font-size: 16px; }
  h3 .sub { font-size: 11px; color: #565f89; font-weight: 400; }
  .sep { width: 100%; border: 0; border-top: 1px solid #1f2030; margin: 4px 0; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #9aa5ce; }
  .check { flex-direction: row; align-items: center; gap: 8px; color: #c0caf5; font-size: 13px; }
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
</style>
