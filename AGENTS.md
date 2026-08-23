# sesh-ui — agent instructions

You are building **sesh-ui**: a graphical client for **sesh** (the multi-machine coding-agent
session manager). Desktop first (**Svelte + Electron**), with **Android** as a second target.

## What this is (and isn't)

- **sesh-ui is a pure CLIENT of sesh's HTTP+JSON API.** It renders state and emits verbs; it never
  reimplements sesh logic. The split is load-bearing (from sesh's own SPEC §6): **anything the UI needs
  sesh to *expose or do* is a change to `sesh` (the daemon), not here.** If you find yourself wanting to
  re-derive naming, routing, or state that sesh owns — stop; that's a sesh-side API addition.
- **sesh lives at `~/mysetup/sesh`** (Go binary + per-machine daemon). Its API is the contract. The
  daemon serves the *same* router on a local unix socket (no auth, local trust) and an opt-in TCP API
  (`SESH_API_ADDR` + `Authorization: Bearer <SESH_API_TOKEN>`). Cross-machine reads/verbs are fanned out
  daemon-side, so a client pointed at ONE daemon already sees and acts on the whole mesh.

## The architecture (don't deviate without a reason)

```
Svelte UI ── seshClient (transport seam) ──┬─ Electron: main-process proxy (unix socket local / TCP+token remote)
  stores ← render / emit verbs             ├─ Android:  native HTTP to a remote hub daemon (tailscale) + Keystore token
                                           └─ Dev:      Vite proxy injects the token (browser)
```

- **One Svelte codebase.** All daemon access goes through **`src/lib/seshClient.js`** — a single seam
  with `get`/`post`/`wsURL`. Svelte stores never know which transport is underneath. This is the spine —
  all daemon access goes through it; keep it clean.
- **The browser can't hit the daemon directly** (no CORS; token required even on preflight). So traffic
  ALWAYS goes through a non-browser layer: the Electron main process, Android native HTTP, or (dev only)
  the Vite proxy. **Never put the bearer token in the renderer** for the Electron/Android transports —
  it lives in the main process / Keystore.

## The two chat surfaces (the reason this app exists)

A thread is one of two runtime shapes; branch on `head` (`headful`/`headless`) and `agent_kind`:

- **pi** → **RPC streaming bubbles** via the daemon WebSocket `GET /v1/threads/rpc?id=` (works headful
  AND headless; token-level streaming). pi-only — claude/codex have no live RPC socket.
- **headful claude/codex (and pi if you want the raw terminal)** → **xterm.js terminal** via the daemon
  WebSocket `GET /v1/threads/terminal?id=&cols=&rows=` (agent-agnostic, detach-safe server-side).
- **headless claude/codex** → **transcript bubbles**: `POST /v1/threads/send-headless` then poll
  `GET /v1/threads/headless-reply` + `GET /v1/threads/transcript`. Each agent's transcript JSONL differs
  (per-agent parsers) — but prefer a future normalized sesh endpoint over reimplementing all three here.

The RPC and terminal WebSocket endpoints already exist in sesh (committed to `~/mysetup/sesh` main);
the Master screen — mycockpit (see Screens) — uses a third streaming WS, `GET /v1/master/terminal`. Everything else the
UI needs is plain request/response on the existing API.

## Screens

The shell is a top-nav router over five screens (`src/App.svelte`), each a component in
`src/components/`:

- **Threads** (`ThreadsScreen`) — the thread grid; new/fork/stop/archive/hold verbs; hosts the two chat
  surfaces above.
- **Tickets** (`TicketsBoard`) — the ticket board: create/edit tickets, bind them to threads, move them
  across machines.
- **Machines** (`MachinesScreen`) — the peers/mesh view (per-machine reachability and detail).
- **Automation** (`AutomationScreen`) — hooks and agent-to-agent `subscriptions` (the daemon's
  `hooks`/`subscriptions` API groups).
- **Master** (`MasterScreen` + `MasterTerminal`) — **mycockpit** ("the cockpit": Lukas's
  cross-machine tmux cockpit, formerly "the master tmux setup"), backed by the master
  streaming WS `GET /v1/master/terminal`. The screen, its components and the endpoint are
  still named `master`; only the prose name changed.

Plus one non-screen surface: **Settings** (`SettingsModal`) — see below.

## Settings live on the DAEMON, not in the app (`ui_config.toml`)

The app's preferences are **not** app-local state. They live in
`<SESH_HOME>/ui_config.toml` on whichever daemon you're connected to, and the daemon serves
them at **`GET`/`POST /v1/ui-config`** (`api.uiConfigGet` / `api.uiConfigSet`). `SettingsModal`
is the editor. This follows the pure-client rule: sesh stores and validates, the app renders —
so the same preferences apply from desktop and Android against one daemon, and a bad value
(e.g. an invalid `cwd_label` regex) comes back as the daemon's **loud 400**, which the modal
surfaces via `pushError` and then reverts its control. Keys: `collapse_parents`, `cwd_roots`,
`cwd_labels`, `transcript_prefetch_secs`, `master_command` (what Master mode runs in the pty),
`default_agent` / `default_machine` / `default_chat_view` (new-thread + open-thread
preselections), and `extra_keys` (the Android touch-keyboard row — an **opaque JSON string the
app owns**; sesh just stores and serves it). Saves are patch-style over the fetched config, and
a field an older daemon doesn't know is omitted rather than sent (it would 400 every save).

## Plugins — daemon-side command providers

`GET /v1/plugins` + `POST /v1/plugins/:name/:capability` (`api.plugins` / `api.pluginRun`) run
commands declared by manifests at `<SESH_HOME>/plugins/*.toml` **on the target daemon's host**.
This exists because the app — especially on Android, or pointed at a remote daemon — has no
shell there. Two capability kinds: **list** (JSON output mapped to `{id,label,groups,path}`
items) and **action** (form fields substituted into the argv as ARGV, never a shell string).

`CwdFuzzyPicker` is the consumer: for each `cwd_roots` entry it looks for a list capability
whose mapped `path` template lives under that root (boxyard's `boxes` maps to `~/dev/{…}`, so
it claims root `~/dev`) and uses it — giving box **names and groups** instead of bare dir
names — plus a sibling action capability from the same plugin for a create affordance. With no
matching plugin (or an older daemon) it falls back to `GET /v1/fs/list` and `cwd_labels`.
Commands come from the manifest only, never from the client.

## The reference prototype (historical)

The app was originally scaffolded from a throwaway Svelte prototype at
**`~/mysetup/sesh/_dev/experiments/03_svelte_shell/`** (chat experiments at `01`, `04`–`08`). The app is
now fully built (`src/`, an `electron/` main-process layer, and a shipped Android build — see `README.md`
/ `ANDROID.md`), so treat the prototype and the scoping docs
`~/mysetup/sesh/_dev/experiments/{UI_SCOPING,FEATURE_UI_MAP}.md` as **historical reference**: they map
every sesh feature to its UI surface and remain useful background, but extend the existing app rather
than rebuilding from them.

## Rules

- **Loud errors over silent fallbacks** (a standing rule across these repos). No defensive defaults that
  mask a bad daemon state — surface it.
- **Honesty about state**: render the daemon's `head`/`busy`/`attachment`/reachability faithfully; an
  offline machine must look offline, not silently stale.
- **Keep `seshClient` the only door to the daemon.** No `fetch`/`WebSocket` scattered in components.
- **Match the surrounding code's style.** Svelte 5 runes (`$state`/`$derived`/`$effect`, `mount()`).
- **Commit messages are prompts** — write each so another agent could recreate the work.

## Running

`npm install` then `npm run dev` (Vite, web/dev transport). For the Electron desktop app and the
Android build, see `README.md`.

For a live daemon to talk to, run an **isolated** dev daemon (never the user's live daemon) with its
TCP API on:

```bash
cd ~/mysetup/sesh && go build -o /tmp/sesh ./cmd/sesh
# SESH_MACHINE is REQUIRED — the daemon refuses to run on a guessed hostname identity, and use a
# DISTINCT name (seshui-dev) so it never collides with the real machine's daemon.
SESH_MACHINE=seshui-dev SESH_HOME=/tmp/seshui-dev SESH_TMUX_SOCKET=seshui-dev SESH_MASTER_SOCKET=seshui-dev-m \
  SESH_CODEX_HOME=/tmp/seshui-codex SESH_API_ADDR=127.0.0.1:8990 SESH_API_TOKEN=devtoken \
  /tmp/sesh daemon run    # (codex needs ~/.codex/auth.json symlinked into SESH_CODEX_HOME)
# spawn a pi thread to chat with (carry the SAME SESH_* env, incl. SESH_MACHINE):
SESH_MACHINE=seshui-dev SESH_HOME=/tmp/seshui-dev ... /tmp/sesh thread new --agent pi --name demo --cwd /tmp --yolo
```

Point the Vite dev proxy at `127.0.0.1:8990` with the `devtoken` (see `vite.config.js`). **Note:** the
streaming endpoints require a daemon built from current sesh `main`; if the daemon you're targeting
predates them, use a dev daemon (above).
