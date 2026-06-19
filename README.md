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

## Desktop app (Electron)

The renderer reaches the daemon **only** through the Electron main process — `ipcRenderer.invoke`
for HTTP, and a loopback WebSocket bridge for the rpc/terminal streams. The bearer token lives only
in main (encrypted at rest via `safeStorage` where an OS keyring exists). Endpoint + token are set in
the in-app **Connection** settings (the ⚙ in the nav); the app auto-opens them on first run when it
can't reach a daemon and none is configured.

```bash
npm run electron:dev     # run the Electron shell against the Vite dev server
npm run electron:build   # vite build + electron-builder → installer in dist-electron/
```

Dev endpoint override (main reads these): `SESH_API_ADDR=host:port` + `SESH_API_TOKEN=…` for a remote
daemon, or `SESH_SOCKET_PATH=…` for a local unix socket. With none set it defaults to
`~/.sesh/daemon.sock`.

### Packaging targets

`electron:build` reads the `build` config in `package.json`. **electron-builder builds for the host
OS only** — cross-compiling installers is not supported here:

- **Linux → AppImage** — builds (and boots) on this Linux box. ✅ verified.
- **macOS → dmg** — build on macOS (`npm run electron:build`). Configured, not built here.
- **Windows → nsis** — build on Windows (or a CI runner). Configured, not built here.

Run `electron:build` on each target OS (or in a per-OS CI job) to produce that platform's installer.
No app icon is set yet, so builds use the default Electron icon.

### Why no local terminal (node-pty)?

The thread terminal is served by the daemon's `GET /v1/threads/terminal` WebSocket — agent-agnostic,
detach-safe, and cross-machine. A node-pty fallback in the Electron main process was considered and
**deliberately skipped**: it would only attach to *local* panes (a remote daemon's panes already need
the daemon's own ssh path), it duplicates detach-safety logic the daemon already owns, and it adds a
native module that must be rebuilt per Electron version — all for a narrow case where, if the daemon
is unreachable, the rest of the app is non-functional anyway. The daemon WS is the single terminal path.
