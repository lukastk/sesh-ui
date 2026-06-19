<script>
  // Phase-0 proof of life: prove the seshClient seam reaches a real daemon. The child
  // thread replaces this with the real screens (Threads / Tickets / Machines) per PLAN.md,
  // rewriting from the reference prototype at ~/mysetup/sesh/_dev/experiments/03_svelte_shell.
  import { sesh, api } from './lib/seshClient.js'

  let daemon = $state(null)
  let rows = $state([])
  let err = $state(null)

  async function refresh() {
    try {
      daemon = await api.status()
      rows = (await api.grid()).rows || []
      err = null
    } catch (e) { err = String(e) }
  }
  $effect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) })
</script>

<main>
  <header>
    <b>sesh</b><span>ui · transport: {sesh.transport}</span>
    {#if daemon}<span class="ok">● {daemon.machine} · schema {daemon.schema} · pid {daemon.pid}</span>
    {:else if err}<span class="err">daemon unreachable</span>{/if}
  </header>

  {#if err}
    <div class="banner">{err}<br /><small>Start a dev daemon (see PLAN.md) and check vite.config.js endpoint/token.</small></div>
  {/if}

  <section>
    <h2>Threads ({rows.length})</h2>
    {#each rows as r}
      <div class="row">
        <span class="g">{r.head === 'headful' ? '●' : '◌'}{r.busy === 'busy' ? '▶' : '·'}</span>
        <span class="nm">{r.name || '(nameless)'}</span>
        <span class="meta">{r.agent_kind} · {r.machine}</span>
      </div>
    {/each}
    {#if rows.length === 0 && !err}<div class="empty">no threads</div>{/if}
  </section>

  <footer>Phase 0 scaffold — see PLAN.md for what to build next.</footer>
</main>

<style>
  :global(body) { margin: 0; background: #11121a; color: #c0caf5; font-family: ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 24px; }
  header { display: flex; align-items: center; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid #1f2030; }
  header b { font-size: 20px; } header span { font-size: 12px; color: #565f89; }
  .ok { color: #9ece6a !important; } .err { color: #f7768e !important; }
  .banner { margin: 14px 0; padding: 12px; background: #3a1c28; color: #ffb4c0; border-radius: 8px; font-size: 13px; }
  h2 { font-size: 14px; color: #9aa5ce; margin: 22px 0 10px; }
  .row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #16161e; }
  .row .g { color: #e0af68; font-size: 14px; }
  .row .nm { flex: 1; }
  .row .meta { font-size: 11px; color: #565f89; }
  .empty { color: #565f89; font-size: 13px; }
  footer { margin-top: 28px; font-size: 11px; color: #3b4261; }
</style>
