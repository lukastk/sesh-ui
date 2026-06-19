# sesh-ui

A graphical client for [**sesh**](../sesh) — the multi-machine coding-agent session manager.
Desktop (Svelte + Electron) first, Android second.

It is a **pure client** of sesh's HTTP+JSON API: it renders threads/tickets/machines and lets you
**chat with each thread inside the UI** (live terminal + streaming bubbles). All daemon access goes
through one transport seam (`src/lib/seshClient.js`); the bearer token never lives in the renderer.

- **Architecture & rules:** `CLAUDE.md`
- **Roadmap & status:** `PLAN.md`
- **Scoping rationale + feature→UI map + reference prototype:**
  `~/mysetup/sesh/_dev/experiments/` (`UI_SCOPING.md`, `FEATURE_UI_MAP.md`, `03_svelte_shell/`)

## Quick start

```bash
npm install
npm run dev      # Vite dev server (web transport via the proxy in vite.config.js)
```

Needs a sesh daemon with its TCP API on — see `PLAN.md` → "Running a dev daemon".
