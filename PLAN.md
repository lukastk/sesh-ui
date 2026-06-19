# sesh-ui — build plan

A graphical client for **sesh** (desktop Svelte/Electron first, Android second). This plan is the
roadmap + status. Update the status markers as you go. Read `CLAUDE.md` first for the architecture.

Status legend: `todo` · `in progress` · `done`.

---

## Phase 0 — scaffold & transport seam (the spine)  · **done**

The single most important thing: a clean `seshClient` transport seam. Everything else builds on it.

- [x] Repo scaffold (this commit): Svelte 5 + Vite, package.json, `src/lib/seshClient.js` seam,
      minimal `App.svelte` proving daemon connectivity, Electron main-process stub.
- [x] **`seshClient` — dev transport**: `get`/`post` via the Vite proxy (token injected by the proxy in
      the http-proxy `proxyReq`/`proxyReqWs` hooks, never in the renderer), `wsURL(path)` for the two
      streaming endpoints. `App.svelte` shows live daemon status; the threads grid renders from
      `GET /v1/threads/grid` against a real dev daemon (verified live — RPC, terminal, headless all
      round-tripped in the browser).
- [ ] **`seshClient` — Electron transport**: renderer → `window.sesh` (contextBridge) → main process
      does `http.request({ socketPath })` for the local unix socket (no token) OR TCP+token for a remote
      daemon (token held ONLY in main, via `safeStorage`). WebSockets: decide main-proxy vs.
      renderer-direct-with-token-from-main; keep the token out of the renderer.
- [ ] Settings: endpoint (local socket / remote `host:port`) + token entry, persisted (keychain in
      Electron). A "connection" indicator in the UI.

## Phase 1 — the screens (port the prototype, rewrite — don't copy)  · **done**

Reference: `~/mysetup/sesh/_dev/experiments/03_svelte_shell/` + `FEATURE_UI_MAP.md`.
All five screens rewritten (not copied) from the prototype and verified live in the browser against the
dev daemon. Loud errors via a persistent toast store (`src/lib/toasts.svelte.js`, separate from the
poll model), honest state glyphs (incl. loud `?` for unknown axes — `src/lib/format.js`), and an honest
RPC default (idle-headless pi has no live rpc-socket → defaults to transcript, RPC stays selectable).

- [x] **Threads grid (home)**: live `GET /v1/threads/grid` poll, state glyphs (head/busy/`?`),
      fuzzy filter, archived toggle, parent/child tree, ticket badges (incl. needs-input), detail/row
      actions (new/+child/resume/headful/stop/archive/rename/delete).
- [x] **Thread detail + the two chat surfaces** (auto-selected per shape + manual switcher):
      - pi (live process) → **RPC streaming bubbles** (`GET /v1/threads/rpc` WebSocket) — verified `RPC-UI-OK`.
      - headful claude/codex (and pi raw) → **xterm.js terminal** (`GET /v1/threads/terminal` WebSocket) — verified live ANSI.
      - headless claude/codex (and idle headless pi) → **transcript bubbles** (send-headless + poll + transcript; per-agent parsers) — verified `HEADLESS-UI-OK`.
- [x] **New-thread modal** (`POST /v1/threads`): agent/name/cwd/headless/mode/initial-msg, cwd via the
      **fs picker** (`GET /v1/fs/list`, ~-relative paths) — verified by creating a thread from the UI.
- [x] **Tickets board** (kanban): `GET /v1/tickets/list-all`, create, status switcher
      (`/v1/tickets/status`) with bind-to-thread picker for `active`, prompt editor (`/v1/tickets/set`),
      send-to-thread (`/v1/tickets/send-prompt`), unbind, delete.
- [x] **Machines/mesh**: `GET /v1/mesh` — reachability dot + freshness + per-machine threads (offline =
      visibly dimmed last-known, never silently stale).

## Phase 2 — Electron desktop app

- [ ] Electron shell wrapping the Svelte build; the Phase-0 main-process transport; node-pty option for a
      local terminal if the daemon WS isn't reachable (optional — the daemon WS is the primary path).
- [ ] Packaging (electron-builder): a real desktop app. Token provisioning UX (paste/QR).

## Phase 3 — Android

- [ ] Capacitor (or Tauri-mobile) shell; **native HTTP** to a remote hub daemon over tailscale (NOT
      WebView fetch — CORS); token in Android Keystore; primary + fallback endpoint.
- [ ] Offline: last-snapshot cache (mesh/grid JSON) rendered with a loud staleness banner; writes require
      connectivity and fail loudly.

## Backlog / sesh-side asks (these are `sesh` changes, raise them — don't hack around in the client)

- **Normalized transcript/chat stream** `GET /v1/threads/chat` (typed turns incl. tool calls/diffs) so
  the client doesn't reimplement 3 agents' JSONL. The biggest remaining backend piece (see sesh exp 08).
- Cross-machine WebSocket: today the UI must dial the thread's *owning* daemon for rpc/terminal; a
  hub-proxy variant in sesh would let the app hit one daemon for everything.
- `/v1/peers` CRUD (so Android can manage machines — `peers.json` is local-file-only today).

---

## Running a dev daemon (for testing against real endpoints)

```bash
cd ~/mysetup/sesh && go build -o /tmp/sesh ./cmd/sesh
# isolated daemon with TCP API on; never touch the user's live daemon:
SESH_HOME=/tmp/seshui-dev SESH_TMUX_SOCKET=seshui-dev SESH_MASTER_SOCKET=seshui-dev-m \
  SESH_CODEX_HOME=/tmp/seshui-codex SESH_API_ADDR=127.0.0.1:8990 SESH_API_TOKEN=devtoken \
  /tmp/sesh daemon run    # (codex needs ~/.codex/auth.json symlinked into SESH_CODEX_HOME)
# spawn a pi thread to chat with:
SESH_HOME=/tmp/seshui-dev ... /tmp/sesh thread new --agent pi --name demo --cwd /tmp --yolo
```

Point the Vite dev proxy at `127.0.0.1:8990` with the `devtoken` (see `vite.config.js`).
**Note:** the live machine daemons run older binaries — the streaming endpoints are only available on a
daemon built from current sesh `main`. Use a dev daemon (above) until the fleet is redeployed.
