# sesh-ui on Android (Phase 3) — feasibility, design, and what's left

**Status: scaffolded + blocked on the build environment.** The same Svelte build runs; the only new
surface is a native transport. mymain (where the overnight run happened) has **no JDK, no Android SDK,
no gradle**, and no phone on `adb`, so the native project can't be generated or built here. Everything
that does NOT need the SDK is in place; the rest is documented below with exact commands.

## The design (decided)

- **One Svelte codebase, Capacitor shell.** Android wraps the existing `dist/` build (see
  `capacitor.config.json`, `webDir: dist`). No second UI.
- **Native HTTP, NOT WebView fetch.** The WebView can't hit the daemon directly (CORS; bearer token
  required even on preflight). So traffic goes through a **native bridge** exactly like Electron's
  main process does. The seam already branches on it:
  `src/lib/seshClient.js` detects `window.SeshNative` (set `transport: 'android'`) and routes
  `get/post/wsURL/peerInfo/getConfig/setConfig` through it — mirroring the Electron `window.sesh`
  contextBridge 1:1. **No renderer code changes are needed when the native side lands.**
- **Token in the Android Keystore, never the WebView.** The native plugin holds the bearer token and
  attaches it to each request; the JS never sees it (same invariant as Electron `safeStorage`).
- **Talks to a remote HUB daemon over tailscale.** Phone → one daemon's TCP API (`SESH_API_ADDR` +
  `Authorization: Bearer`). Cross-machine reads/verbs fan out daemon-side, so one hub already sees the
  whole mesh (the grid all-machines + cross-machine chat dialing work the same as desktop).
- **Primary + fallback endpoint**, and an **offline snapshot cache** (last mesh/grid JSON rendered with
  a loud staleness banner; writes require connectivity and fail loudly).

## The native bridge contract (what the Capacitor plugin must expose)

The plugin injects `window.SeshNative` with the SAME shape as `electron/preload.cjs`'s `window.sesh`:

```
window.SeshNative = {
  get(path, machine?) -> Promise<json>      // native HTTP GET /v1<path> to the resolved daemon
  post(path, body, machine?) -> Promise<json>
  wsBase: "ws://127.0.0.1:<loopback>"        // a native loopback WS bridge (token injected upstream)
  peerInfo() -> Promise<{connected, peers[]}> // from the hub's peers (or a /v1/peers endpoint)
  getConfig() -> Promise<{mode,target,hasToken,editable,configured}>
  setConfig({mode,host,port,token}) -> Promise // token → Keystore, never returned
}
```
`machine` is the cross-machine-chat target (Phase-2 feature); on mobile the hub can proxy, or the
plugin dials the peer's api_addr like the desktop main process. A `/v1/peers` listing endpoint in sesh
(backlog) would let the phone discover peer api-addrs without a local `peers.json`.

## What's left (needs an SDK-equipped machine)

1. Install toolchain: **JDK 17**, **Android SDK** (`sdkmanager` "platform-tools" "platforms;android-34"
   "build-tools;34.0.0"), set `ANDROID_HOME`; `gradle` comes via the wrapper.
2. `npm i -D @capacitor/cli && npm i @capacitor/core @capacitor/android`
3. `npx cap add android` (generates `android/` — a gradle project; do NOT commit build outputs).
4. Implement the **native bridge plugin** (Kotlin) per the contract above: an OkHttp client with the
   Keystore-held bearer token, a loopback WS proxy for rpc/terminal, and Keystore read/write for
   `setConfig`. Register it so it injects `window.SeshNative` at startup.
5. `npx cap sync && npx cap run android` onto a device (host the user's phone as **android-main** over
   `adb` — see the `android-control` skill; it was not present on mymain tonight).
6. Verify: live grid, a pi RPC chat, a headless transcript, and the offline staleness banner.

## Why it's last
Highest chance of an environment wall (confirmed: no SDK/JDK on mymain). The seam + config are done so
that when the toolchain exists, only the native plugin + `cap add android` remain — no UI rework.
