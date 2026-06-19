<script>
  // Connection settings: which daemon to talk to (local unix socket / remote host:port + token)
  // and the token. The token is WRITE-ONLY — getConfig never returns its value, only whether one
  // is set; we send a new token only if the user types one. In web/dev the endpoint is the fixed
  // Vite proxy (read-only). On save, the Electron main process rebuilds its transport and reloads.
  import { sesh } from '../lib/seshClient.js'
  import { pushError } from '../lib/toasts.svelte.js'

  let { onclose } = $props()

  let cfg = $state(null)        // { mode, target, hasToken, editable }
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
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 90; }
  .modal { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 20px 22px; width: 420px; max-width: 92vw; display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0 0 2px; font-size: 16px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #9aa5ce; }
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
