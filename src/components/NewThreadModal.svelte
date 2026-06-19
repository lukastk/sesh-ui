<script>
  // New-thread modal → POST /v1/threads. Agent / name / cwd (fs picker) / headless / mode,
  // plus an optional initial message for a headed spawn (sent once the agent is READY).
  import { api } from '../lib/seshClient.js'
  import FsPicker from './FsPicker.svelte'

  let { parent = '', onclose, oncreated } = $props()

  let agent = $state('pi')
  let name = $state('')
  let cwd = $state('~')
  let headless = $state(false)
  let mode = $state('yolo')
  let msg = $state('')
  let busy = $state(false)
  let err = $state(null)
  let showPicker = $state(false)

  async function create() {
    busy = true; err = null
    try {
      const req = { agent, name: name.trim(), cwd: cwd.trim() || '~', headless, mode }
      if (parent) req.parent = parent
      if (!headless && msg.trim()) req.msg = msg.trim()
      const res = await api.threadNew(req)
      oncreated(res.thread.id)
    } catch (e) { err = String(e); busy = false }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
    <h3>New thread{#if parent}<span class="par"> · child</span>{/if}</h3>

    <label>Agent
      <div class="seg">
        {#each ['pi', 'claude', 'codex'] as a}
          <button class:on={agent === a} onclick={() => (agent = a)}>{a}</button>
        {/each}
      </div>
    </label>

    <label>Name <input bind:value={name} placeholder="(optional)" /></label>

    <label>Working directory
      <div class="cwd">
        <input bind:value={cwd} placeholder="~ or ~/path" />
        <button class="pick" onclick={() => (showPicker = true)}>Browse…</button>
      </div>
    </label>

    <div class="opts">
      <label class="check"><input type="checkbox" bind:checked={headless} /> headless (no tmux window)</label>
      <label class="mode">mode
        <select bind:value={mode}>
          <option value="yolo">yolo</option>
          <option value="default">default</option>
          <option value="sandbox">sandbox</option>
        </select>
      </label>
    </div>

    {#if !headless}
      <label>Initial message <input bind:value={msg} placeholder="(optional — sent once the agent is ready)" /></label>
    {/if}

    {#if err}<div class="err">{err}</div>{/if}

    <div class="actions">
      <button onclick={onclose}>Cancel</button>
      <button class="primary" onclick={create} disabled={busy}>{busy ? 'Spawning…' : 'Create'}</button>
    </div>
  </div>
</div>

{#if showPicker}
  <FsPicker bind:value={cwd} onclose={() => (showPicker = false)} />
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex;
    align-items: center; justify-content: center; z-index: 50; }
  .modal { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 20px 22px;
    width: 400px; max-width: 92vw; display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0 0 2px; font-size: 16px; }
  h3 .par { font-size: 11px; color: #7aa2f7; font-weight: 400; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #9aa5ce; }
  input, select { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px;
    padding: 8px; font-size: 13px; font-family: inherit; }
  .cwd { display: flex; gap: 8px; }
  .cwd input { flex: 1; }
  .pick { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px;
    padding: 0 12px; cursor: pointer; font-size: 12px; white-space: nowrap; }
  .opts { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .check { flex-direction: row; align-items: center; gap: 8px; }
  .mode { flex-direction: row; align-items: center; gap: 6px; }
  .seg { display: flex; border: 1px solid #2a2b3d; border-radius: 7px; overflow: hidden; }
  .seg button { flex: 1; border: 0; background: #1a1b26; color: #9aa5ce; padding: 7px; font-size: 13px; cursor: pointer; }
  .seg button.on { background: #7aa2f7; color: #11121a; font-weight: 600; }
  .err { background: #3a1c28; color: #ffb4c0; border-radius: 6px; padding: 8px; font-size: 11px; white-space: pre-wrap; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .actions button { background: #1a1b26; color: #c0caf5; border: 1px solid #2a2b3d; border-radius: 7px;
    padding: 7px 16px; cursor: pointer; font-size: 13px; }
  .actions .primary { background: #7aa2f7; color: #11121a; border: 0; font-weight: 600; }
  .actions button:disabled { opacity: 0.5; }
</style>
