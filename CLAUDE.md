# sesh-ui — agent instructions

You are building **sesh-ui**: a graphical client for **sesh** (the multi-machine coding-agent
session manager). Desktop first (**Svelte + Electron**), with **Android** as a second target.

Read **`PLAN.md`** for the roadmap and current phase before doing anything.

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
  with `get`/`post`/`wsURL`. Svelte stores never know which transport is underneath. This is the spine;
  build it first and keep it clean.
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

Both WebSocket endpoints already exist in sesh (committed to `~/mysetup/sesh` main). Everything else the
UI needs is plain request/response on the existing API.

## The reference prototype

A throwaway Svelte prototype that proved every screen lives at
**`~/mysetup/sesh/_dev/experiments/03_svelte_shell/`** (and the chat experiments at `01`, `04`, `05`,
`06`, `07`, `08`). **Rewrite from it — do NOT copy-paste.** The scoping verdict + feature→UI map are in
`~/mysetup/sesh/_dev/experiments/{UI_SCOPING,FEATURE_UI_MAP}.md` — read them; they map every sesh feature
to its UI surface and call out the priorities and risks.

## Rules

- **Loud errors over silent fallbacks** (a standing rule across these repos). No defensive defaults that
  mask a bad daemon state — surface it.
- **Honesty about state**: render the daemon's `head`/`busy`/`attachment`/reachability faithfully; an
  offline machine must look offline, not silently stale.
- **Keep `seshClient` the only door to the daemon.** No `fetch`/`WebSocket` scattered in components.
- **Match the surrounding code's style.** Svelte 5 runes (`$state`/`$derived`/`$effect`, `mount()`).
- **Commit messages are prompts** — write each so another agent could recreate the work.
- Update `PLAN.md`'s status as you complete phases.

## Running

`npm install` then `npm run dev` (Vite, web/dev transport). Electron + Android come in later phases —
see `PLAN.md`. For a live daemon to talk to: build sesh (`cd ~/mysetup/sesh && go build -o /tmp/sesh
./cmd/sesh`) and run an isolated daemon with its TCP API on (see `PLAN.md` → "Running a dev daemon").
