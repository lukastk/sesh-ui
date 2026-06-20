# sesh-ui — build plan

A graphical client for **sesh** (desktop Svelte/Electron first, Android second). This plan is the
roadmap + status. Update the status markers as you go. Read `CLAUDE.md` first for the architecture.

Status legend: `todo` · `in progress` · `done`.

> **READY FOR LUKAS (2026-06-20).** Desktop app is feature-complete against the mapped P1 set and
> stress-tested end-to-end (see `STRESSTEST.md`): the 4 reported UI bugs are fixed; every chat surface,
> lifecycle verb, tickets/automation/machines screen, blobs, fork, tags, reparent, notify, and peer
> add/remove are verified live. All synced to `lukas@macbook:~/sesh-ui` (dist rebuilt). **Two things need
> Lukas:** (1) confirm **cross-machine chat** in the Electron app at the Mac (the transport is proven —
> the WS bridge routed a live macstudio terminal — but the Playwright MCP can't drive an Electron CDP
> port, so the GUI step is his); (2) review the **sesh `/v1/peers` change** (commit `4eb37f3`, schema 22)
> and **redeploy the fleet** — the overnight run only put it on the isolated dev daemon. Remaining work is
> **Android** (blocked on his SDK+device; seam+config scaffolded — see `ANDROID.md`).

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

### Hardening (post-review, driven live on mymain)
- [x] **Toast flood on daemon outage fixed** — background polls (status/grid/tickets/mesh) no longer
      each spawn a persistent toast. A shared `connection.svelte.js` store collects poll reachability;
      App renders ONE banner from `!conn.online`; `pushError` dedupes (×count). Verb-failure toasts
      stay loud. Daemon-down → reconnect is graceful (banner auto-clears). Verified by killing/restarting
      the dev daemon mid-poll.
- [x] **In-app dialogs replace `window.prompt`/`confirm`** (`PromptDialog`/`ConfirmDialog`) — `prompt()`
      is a silent no-op in Electron, so thread Rename did nothing there; now works on web AND Electron
      (verified in real Electron via CDP).
- [x] **All-machines grid by default** — the Threads grid now requests `all-machines` (default ON, with
      a visible toggle), matching `sesh tui` (whose wrapper adds `--all-machines`). The daemon fans out
      to its peers, so one connection shows the whole mesh; remote rows carry a `⌘ <machine>` badge.
- [x] **Graceful remote threads** — the app has ONE transport (the connected daemon). A thread whose
      `row.machine` differs from the connected daemon (`/status`.machine, tracked in `connection.svelte.js`)
      can't have its rpc/terminal/transcript served here, so its CHAT surface shows a clear notice instead
      of 404/409-ing. Grid/tickets/machines still show it; lifecycle verbs still fan out daemon-side. (Full
      cross-machine chat = dialing the owning daemon — see backlog.)
- [x] **Transcript-404 console noise silenced** — a never-run thread legitimately has no transcript (404);
      the renderer already treats it as empty, but Electron's `ipcMain.handle` logged every such rejection
      as "Error occurred in handler for sesh:get". Main now resolves a structured `{ok}|{error,status}`
      result (unwrapped back to resolve/throw in `preload.cjs`, so the renderer's loud-error contract is
      unchanged) and logs ONLY genuine failures (transport errors / 5xx), never an expected 4xx.
- [x] **Launcher defaults to the real daemon** — `launch-sesh-ui.command` points the app at the real local
      `~/.sesh/daemon.sock` (normal use); the isolated demo daemon + demo threads are behind `SESHUI_DEMO=1`.

### Hardening (round 2 — Lukas stress test, driven live via Playwright; see `STRESSTEST.md`)
- [x] **BUG 1 — headful claude/codex Terminal "terminal does not support clear"** (sesh-side): the daemon
      now forces `TERM=xterm-256color` in the UI-terminal attach pty (sesh `047467e`, deployed to macbook;
      still to roll out to other machines' daemons). Verified live: claude + codex xterm render fully.
- [x] **BUG 2 — pi RPC chat dropped TUI-typed turns + lost history on switch**: RPC chat is now
      transcript-backed — load + poll the transcript (source of truth, incl. TUI-typed turns) and overlay
      the live socket stream for the in-flight UI turn, de-duplicated. History persists across switches.
- [x] **Tickets poll clobbered in-progress edits** (found in stress test): the 3s board refresh merged the
      daemon's ticket over the open dialog, wiping unsaved name/prompt edits. Now syncs only status/binding.
- [x] **Shared transcript parser** (`src/lib/transcript.js`): the three agents' JSONL decode lives in one
      place (HeadlessChat + RpcChat), instead of duplicated per surface.
- [x] **Full stress pass**: every chat surface (pi RPC, claude/codex Terminal, headless Transcript), all
      lifecycle verbs, the tickets board end-to-end, machines, and the daemon-unreachable / reconnect /
      never-run edge cases — all pass (no toast flood, graceful reconnect, honest loud verb errors).

### Hardening (round 3 — overnight autonomous run)
- [x] **4 reported UI bugs** (`64ecc43`): (1) initial-message bubble duplication in pi RPC — freeze the
      history poll during a UI turn + stable bubble keys so the optimistic copy is swapped, not doubled;
      (2) chat scroll bled into the page — `overscroll-behavior: contain` on every scroll region;
      (3) auto-follow — logs stick to the bottom only when already there, with a "↓ latest" jump button;
      (4) collapse/expand the grid tree (TUI-style fold), persisted in localStorage. (1)+(4) verified live.
- [x] **Cross-machine chat** (`6ad8ea3`): the transport seam now dials a remote thread's OWNING daemon
      for rpc/terminal/transcript. `electron/peers.cjs` reads `~/.sesh/peers.json` (token in main); the WS
      bridge routes per-connection by a `__machine` param; ThreadsScreen renders real chat for a dial-able
      remote thread (notice only for ssh-only peers / the web build). Proven headlessly against the real
      mesh (HTTP + a live macstudio terminal routed through the bridge). TERM fix + TCP API now live on
      macbook, mymain, macstudio. **Pending: final GUI check from the Mac app (Lukas).**

## Phase 2 — Electron desktop app  · **done**

- [x] **Main-process transport** (`electron/transport.cjs` + `config.cjs` + `main.cjs`): the renderer
      reaches the daemon ONLY through main — `ipcRenderer.invoke('sesh:get'|'sesh:post')` for HTTP
      (unix socket local / TCP+token remote), and a **loopback WS bridge** for rpc/terminal (a renderer
      WebSocket can't set headers or dial a unix socket, so main proxies the upgrade and injects
      auth/socketPath upstream). The bearer token lives ONLY in main, encrypted at rest via `safeStorage`.
      Verified: transport module headlessly against the dev daemon (both transports, RPC + terminal
      bridge round-trips, loud rejects); the full Electron app booting under xvfb (live grid + daemon
      header through IPC, token only in main).
- [x] **Token provisioning UX** (`SettingsModal.svelte` + the nav ⚙ + first-run auto-open): set the
      endpoint (local socket / remote host:port) + token; token is write-only (never read back to the
      renderer). On an unreachable, unconfigured first run the Settings open automatically and the
      banner offers "Configure connection…". Verified end-to-end over CDP: save → window reloads →
      reconnects to the dev daemon; renderer `getConfig` shows `hasToken` but never the value.
- [x] **Packaging** (`electron-builder`): `npm run electron:build` → **Linux AppImage built AND booted**
      under xvfb (renders the live app through its bundled main process). `base:'./'` for the build so
      file:// asset paths resolve. mac dmg / win nsis are configured in `package.json` `build` but must
      be built on those OSes / CI (electron-builder is host-OS-only) — documented in README.
- [x] **node-pty local terminal — deliberately skipped** (not needed). The daemon WS terminal is the
      single terminal path (agent-agnostic, detach-safe, cross-machine); a node-pty fallback would only
      reach local panes, duplicate server-side detach-safety, and add a per-Electron-version native
      module, for a case where an unreachable daemon already breaks the rest of the app. Rationale in README.

## Phase 3 — Android  · **done — running on android-main, MVP + streaming verified on-device**

Built on **macbook** (the SDK-equipped machine; mymain had no JDK/SDK). See **`ANDROID.md`** for the
full design. Toolchain installed (JDK 17 Temurin, Android SDK android-34 + build-tools 34, Gradle 8.2.1
wrapper). The **hub daemon is mymain:7878** (rebuilt from origin/main `5fd5157` — serves `?token=` WS +
`/v1/peers`, schema 22, verified live over Tailscale). Phone = android-main (Pixel 9, 100.67.70.114),
paired over wifi. **Verified on-device:** real all-machines grid (25 threads) + tickets (47) + machines
(3, peer add/remove), headless transcript (real agent output), pi RPC streaming bubbles AND live xterm
terminal over the `?token=` WS loopback bridge, token in the Keystore (survives reinstall), responsive
phone layout (no two-axis scroll), and the offline cold-start cache + loud staleness banner.

- [x] **Seam ready**: `seshClient` detects a native `window.SeshNative` bridge (`transport: 'android'`)
      and routes get/post/wsURL/peerInfo/getConfig/setConfig through it, mirroring the Electron
      `window.sesh` contextBridge 1:1 — so NO renderer changes are needed when the native side lands.
- [x] **sesh `?token=` WS auth** (sesh `e00bd2a`, in origin/main): the two WS routes accept the bearer
      token via `?token=` (a WebView WS can't set the Authorization header). Scoped to rpc/terminal,
      constant-time, conformance-tested, deployed to the mymain hub.
- [x] **Capacitor shell**: `capacitor.config.ts` (appId `work.jackfruiting.seshui`, webDir `dist`),
      `@capacitor/{core,cli,android}@6`, `npx cap add android` → `android/` gradle project. `npm run
      build` → `cap sync` → **`./gradlew assembleDebug` builds `app-debug.apk` (4.5M)**.
- [x] **Native bridge plugin** (Kotlin, `android/app/.../Sesh*.kt`): `window.SeshNative` 1:1 with the
      Electron contract. `SeshHttp` (OkHttp, native HTTP + Bearer header — NOT WebView fetch), `SeshWsBridge`
      (loopback Java-WebSocket server ⇄ OkHttp upstream, token injected as `?token=` upstream), `SeshStore`
      (token encrypted via an AndroidKeyStore AES-GCM key — never the WebView), `SeshNativePlugin`
      (get/post/getWsBase/peerInfo/getConfig/setConfig). Primary + fallback endpoint. `public/sesh-native-bridge.js`
      injects `window.SeshNative` before the bundle. **Compiles + APK builds.**
- [x] **Paired over wifi + installed on android-main** (Pixel 9). Endpoint + token set on-device
      (Settings → Remote TCP, mymain hub); token persists in the AndroidKeyStore across reinstall.
      MVP verified: real all-machines grid + tickets + machines (peer add/remove) + headless transcript.
- [x] **Streaming on-phone**: pi RPC bubbles (marker round-trip) AND a live xterm terminal (live tmux
      pane, real ANSI) over the `?token=` WS loopback bridge — both verified on android-main.
- [x] **Mobile layout** (responsive, single-pane Threads with a back button, swipe kanban, no page
      scroll) + **offline last-snapshot cache** with a loud staleness banner (writes fail loudly).

## Backlog / sesh-side asks (these are `sesh` changes, raise them — don't hack around in the client)

- **Normalized transcript/chat stream** `GET /v1/threads/chat` (typed turns incl. tool calls/diffs) so
  the client doesn't reimplement 3 agents' JSONL. The biggest remaining backend piece (see sesh exp 08).
- **Cross-machine CHAT** (the gated case above): today the UI must dial the thread's *owning* daemon for
  rpc/terminal, and the transcript is local-store-only, so chatting with a remote thread from the connected
  daemon isn't possible — the UI shows a notice. A hub-proxy variant in sesh (the connected daemon proxies
  the rpc/terminal upgrade + transcript fetch to the owning peer) would let the app chat with any thread
  over one connection. This is the right fix; do NOT hack per-daemon dialing into the client.
- **`/v1/peers` CRUD** — BUILT in sesh (commit `4eb37f3` on the sesh repo): additive GET list / POST add
  / POST remove over the existing peers registry, SchemaVersion 21→22, with a conformance test. The
  Machines screen now lists/adds/removes peers against it (verified live on the dev daemon). **Pending
  Lukas: review the sesh change + redeploy the fleet** — NOT deployed to the live daemons by the overnight
  run (only the isolated dev daemon runs the schema-22 binary). Until the fleet is on ≥22, the Machines
  peer panel shows a "needs daemon ≥22" note against an older daemon.

---

## Running a dev daemon (for testing against real endpoints)

```bash
cd ~/mysetup/sesh && go build -o /tmp/sesh ./cmd/sesh
# isolated daemon with TCP API on; never touch the user's live daemon.
# NB: SESH_MACHINE is REQUIRED — the daemon refuses to run on a guessed hostname identity,
# and use a DISTINCT name (seshui-dev) so it never collides with the real machine's daemon.
SESH_MACHINE=seshui-dev SESH_HOME=/tmp/seshui-dev SESH_TMUX_SOCKET=seshui-dev SESH_MASTER_SOCKET=seshui-dev-m \
  SESH_CODEX_HOME=/tmp/seshui-codex SESH_API_ADDR=127.0.0.1:8990 SESH_API_TOKEN=devtoken \
  /tmp/sesh daemon run    # (codex needs ~/.codex/auth.json symlinked into SESH_CODEX_HOME)
# spawn a pi thread to chat with (carry the SAME SESH_* env, incl. SESH_MACHINE):
SESH_MACHINE=seshui-dev SESH_HOME=/tmp/seshui-dev ... /tmp/sesh thread new --agent pi --name demo --cwd /tmp --yolo
```

Point the Vite dev proxy at `127.0.0.1:8990` with the `devtoken` (see `vite.config.js`).
**Note:** the live machine daemons run older binaries — the streaming endpoints are only available on a
daemon built from current sesh `main`. Use a dev daemon (above) until the fleet is redeployed.
