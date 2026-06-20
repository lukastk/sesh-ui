<script>
  // New-thread modal → POST /v1/threads. Agent / name / cwd (fs picker) / headless / mode,
  // plus an optional initial message for a headed spawn (sent once the agent is READY).
  import { api, sesh } from '../lib/seshClient.js'
  import { modelSuggestions } from '../lib/models.js'
  import FsPicker from './FsPicker.svelte'

  // forkFrom: branch an existing thread's conversation (its full prefix, message_id 0). The new
  // thread's agent/cwd default to the source's, so they're pre-filled from forkAgent/forkCwd.
  let { parent = '', forkFrom = '', forkAgent = 'pi', forkName = '', forkCwd = '~', onclose, oncreated } = $props()

  const isFork = !!forkFrom
  let agent = $state(isFork ? forkAgent : 'pi')
  let name = $state(isFork && forkName ? `${forkName}-fork` : '')
  let cwd = $state(isFork ? forkCwd : '~')
  let headless = $state(false)
  let mode = $state('yolo')
  let model = $state('')   // free-text pass-through; '' = the agent's default
  let msg = $state('')
  let busy = $state(false)
  let err = $state(null)
  let showPicker = $state(false)

  // Target machine. Default = the connected/local daemon; a peer routes the spawn there (sesh
  // `thread new --machine`). Forks inherit the source's machine, so the picker is hidden for forks.
  let connectedMachine = $state(null)
  let machines = $state([])
  let machine = $state('')   // '' until peerInfo resolves; then the connected machine
  $effect(() => {
    sesh.peerInfo().then((i) => {
      connectedMachine = i.connected
      machines = [i.connected, ...(i.peers || [])].filter(Boolean)
      if (!machine) machine = i.connected || ''
    }).catch(() => {})
  })
  // The machine to ROUTE to (undefined = the connected/local daemon, the common case).
  let targetMachine = $derived(machine && machine !== connectedMachine ? machine : undefined)

  async function create() {
    busy = true; err = null
    try {
      const req = { agent, name: name.trim(), cwd: cwd.trim() || '~', headless, mode }
      if (model.trim()) req.model = model.trim()  // pinned model (pass-through; '' = agent default)
      if (parent) req.parent = parent
      if (isFork) { req.fork_from = forkFrom; req.message_id = 0 } // branch the whole conversation
      if (!headless && msg.trim()) req.msg = msg.trim()
      const res = await api.threadNew(req, targetMachine)
      oncreated(res.thread.id)
    } catch (e) { err = String(e); busy = false }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
    <h3>{isFork ? 'Fork thread' : 'New thread'}{#if isFork}<span class="par"> · branch of {forkName || 'source'}</span>{:else if parent}<span class="par"> · child</span>{/if}</h3>

    <label>Agent
      <div class="seg">
        {#each ['pi', 'claude', 'codex'] as a}
          <button class:on={agent === a} onclick={() => (agent = a)}>{a}</button>
        {/each}
      </div>
    </label>

    <label>Name <input bind:value={name} placeholder="(optional)" /></label>

    {#if !isFork && machines.length > 1}
      <label>Machine
        <select bind:value={machine}>
          {#each machines as m (m)}
            <option value={m}>{m}{m === connectedMachine ? ' (this)' : ''}</option>
          {/each}
        </select>
      </label>
    {/if}

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

    <label>Model <span class="hint">(optional · any model the {agent} accepts)</span>
      <input bind:value={model} list="model-suggestions" placeholder="(agent default)" autocomplete="off" />
      <datalist id="model-suggestions">
        {#each modelSuggestions(agent) as m}<option value={m}></option>{/each}
      </datalist>
    </label>

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
  <FsPicker bind:value={cwd} machine={targetMachine} onclose={() => (showPicker = false)} />
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex;
    align-items: center; justify-content: center; z-index: 50; }
  .modal { background: #16161e; border: 1px solid #2a2b3d; border-radius: 12px; padding: 20px 22px;
    width: 400px; max-width: 92vw; display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0 0 2px; font-size: 16px; }
  h3 .par { font-size: 11px; color: #7aa2f7; font-weight: 400; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #9aa5ce; }
  .hint { color: #565f89; font-weight: 400; }
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
