# sesh-ui stress test — checklist & log

Driven live via Playwright (web transport) against an isolated dev daemon on mymain
(`seshui-dev`, TCP :8990) built from sesh main + the TERM fix. Threads cover pi/claude/codex
in headful + headless, plus idle/dead/never-run states.

Legend: ✅ pass · 🔧 fixed-bug (commit) · ⚠️ known-limitation

## Bugs from Lukas
- ✅🔧 BUG 1 — headful claude/codex Terminal "terminal does not support clear" → sesh daemon forces
  `TERM=xterm-256color` in the UI-terminal pty (sesh `047467e`, deployed to macbook). UI verified:
  claude xterm renders the full Claude Code UI + accepts typed input; codex xterm renders the full
  Codex UI.
- ✅🔧 BUG 2 — pi RPC chat missed TUI-typed turns + lost history on switch → transcript-backed RPC
  (`cd27369` + ribbon onopen honesty). UI verified: UI→agent streams live; a turn typed in the pi
  TUI (send-keys) appears in the UI via transcript poll; both turns render once (no dup, thinking
  shown); switching threads and back reloads history (never blanks).

## Chat surfaces
- ✅ pi RPC (headful): UI→agent stream, TUI→UI via transcript poll, history persists, no dup
- ✅ claude Terminal (headful): xterm renders, typed input echoes into the pane
- ✅ codex Terminal (headful): xterm renders full Codex UI
- ✅ claude Transcript (headless): send → reply rendered
- ✅ never-run thread (headless claude/pi): "No transcript yet" empty state, 404 handled gracefully

## Lifecycle verbs
- ✅ new modal: agent select, name, fs picker cwd (lists ~, up/breadcrumb/Use), headless, mode, create
- ✅ rename (in-app PromptDialog, pre-filled) → persists
- ✅ archive → hides; archived toggle (the `=1` param fix) shows it back with ·archived tag
- ✅ delete (ConfirmDialog, correct "record only" vs headful message) → removed
- ✅ stop (headful codex → dead/headless, actions become Resume/Headful)
- ✅ headful/resume verb path exercised; correctly surfaces a daemon 422 as a single loud toast for a
  never-ran codex ("no session id — nothing to resume") — honest, not a UI bug
- (resume/+child/reparent share the same verb+toast path; not each clicked)

## Tickets board
- ✅ create → triage column
- 🔧 prompt edit: the 3s poll was clobbering in-progress edits → fixed (`9f10e96`); prompt now survives
  a poll and persists to the daemon
- ✅ status switch → active opens bind-to-thread picker (lists all threads w/ glyphs); bound to pi
- ✅ send-to-thread: prompt delivered into the bound pi pane (agent received + acted on it)
- ✅ unbind → unbound; external status change (agent set it done) reflected without clobbering the prompt
- ✅ delete (ConfirmDialog) → removed

## Machines / mesh
- ✅ reachability (live dot), freshness, per-machine thread list with head glyphs (single-machine dev
  daemon here; multi-machine + offline rendering verified earlier against the real macbook mesh)

## Edge / error
- ✅ daemon unreachable: ONE banner ("Cannot reach the sesh daemon" + error), header "daemon
  unreachable", last-known threads still shown (not blanked), ZERO toast flood
- ✅ graceful reconnect: restarting the daemon auto-clears the banner (new pid in header), no manual action
- ✅ never-run thread: empty state, app-level handled; browser network-404 is devtools-only and silent in
  Electron via the main-process structured-result fix
- ⚠️ remote thread graceful notice: verified earlier on the real macbook mesh (mymain/macstudio rows);
  a single-machine dev daemon can't reproduce it here
- ⚠️ pi RPC ribbon for a just-opened socket shows "connected" until pi emits its first state event
  (pi only broadcasts state around a turn) — cosmetic, now honest (was stuck at "connecting…")

## Round 3 (overnight autonomous run)
- ✅🔧 4 reported UI bugs: bubble dup (one user + one assistant, no flash), tree fold (collapse hides
  subtree, persists across reload), overscroll containment, auto-follow + jump button — all driven live.
- ✅ Cross-machine chat transport: peers.cjs resolves macstudio; HTTP /status + a WS terminal both route
  through the bridge to macstudio's daemon (267 bytes of live pane). TERM fix + TCP API live on all 3
  daemons. (Final Electron-GUI verify on the Mac is for Lukas.)
- ✅ Automation center: hooks empty-state; subscriptions add (two-thread picker) + remove round-trip.
- ✅ Thread fork: "Fork" → modal pre-filled from source → new thread carries the source's transcript.
- ✅ Blob attachments: 📎 upload → chip + @blob token; daemon stored exact bytes + token expands to a path.
- ✅ Android: seam branch + capacitor config build clean (dead-code off-device); env wall documented.
- ✅ Continuous regression pass: local RPC chat still streams after the machine-param + transport
  refactors (one user + one assistant, no dup); all four nav tabs render; Tickets/Machines intact.

## Round 4 (overnight, click-only — Playwright drag is banned, it hangs)
- ✅ Tags: add chip via "+ add tag" (Enter) + remove via × — round-trips.
- ✅ Reparent: click-based "Set parent…" picker reparents a thread under the chosen parent (tree
  restructures, fold chevron appears). Drag-drop affordance also in the UI but NOT tested via
  browser_drag (it hangs the turn — see memory). "(make a root thread)" option present.
- ✅ Notify bell toggles 🔔↔🔕.
- ✅ Auto-follow + jump button: scrolled up → "↓ latest" appears; click → returns to bottom + hides.
- 🔧 Layout bug found + fixed: `main` lacked `min-height:0`, so a long transcript overflowed the PAGE
  instead of the log scrolling internally (defeating auto-follow/overscroll). Fixed + verified: log now
  scrolls internally, page doesn't overflow.
- ✅ Blob attach END-TO-END: 📎 upload → @blob token → send-headless → the daemon expands the token to
  a real path in the delivered message. (A sandboxed headless claude then can't read outside its cwd —
  a sesh sandbox policy, not a UI issue; a yolo/headful agent reads it.)
- ✅ Hooks (after adding two `[[hooks]]` to the dev daemon config): list renders (event/edge/command);
  **Test** runs the command synchronously and shows output ("idle-hook-fired", ok); **Enable/Disable**
  toggles the mute. Empty-state also confirmed earlier.
- ⚠️ Peer add/remove: blocked — no `/v1/peers` daemon API (sesh-side ask, logged in PLAN backlog).
