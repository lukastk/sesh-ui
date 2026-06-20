# sesh-ui on Android (Phase 3) — design + status

**Status: DONE — running on android-main (Pixel 9), MVP + streaming verified on-device.**
Built on **macbook** (JDK 17 Temurin + Android SDK android-34/build-tools 34, set via `ANDROID_HOME`;
Gradle 8.2.1 wrapper). The same Svelte build runs unchanged; the only new surface is the native
transport (the `android/` Capacitor project + the `SeshNative` Kotlin plugin). `./gradlew assembleDebug`
produces `android/app/build/outputs/apk/debug/app-debug.apk`.

Verified on-device over Tailscale: real all-machines grid (25 threads) + tickets (47) + machines
(3, peer add/remove); headless transcript (real agent output); **pi RPC streaming bubbles** and a
**live xterm terminal** (live tmux pane) over the `?token=` WS loopback bridge; token in the
AndroidKeyStore (persists across reinstall); responsive phone layout (no two-axis scroll); offline
cold-start cache behind a loud staleness banner.

**Hub daemon: mymain:7878** (Tailscale <your-tailscale-ip>), rebuilt from origin/main `5fd5157` — serves the
`?token=` WS auth + `/v1/peers` (schema 22). Fallback: macstudio:7878 (100.125.115.38, still on the
older binary — HTTP works, streaming would need its redeploy). Token: `~/.sesh/api-token` on macbook.
Phone: android-main (Pixel 9, <your-tailscale-ip>). **Set the endpoint + token on-device in Settings** (the
token is entered at runtime → Keystore; it is NEVER baked into the committed app).

## Build/run commands (macbook)

```bash
source /tmp/android-env.sh          # JAVA_HOME=temurin-17, ANDROID_HOME=~/Library/Android/sdk, PATH
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
# install + drive on android-main (after wifi pairing — see the android-control skill):
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## The design (decided)

- **One Svelte codebase, Capacitor shell.** Android wraps the existing `dist/` build (see
  `capacitor.config.ts`, `webDir: dist`). No second UI.
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

## How it's implemented (`android/app/src/main/java/work/jackfruiting/seshui/`)

- **`SeshNativePlugin.kt`** — `@CapacitorPlugin("SeshNative")`: `get/post/getWsBase/peerInfo/getConfig/
  setConfig`, registered in `MainActivity` before `super.onCreate` so the bridge exists at bundle eval.
- **`SeshHttp.kt`** — OkHttp GET/POST to the hub with the `Authorization: Bearer` header attached
  natively; structured `{ok,data}|{ok:false,error,status}` result (loud 4xx); primary→fallback failover
  on transport errors only.
- **`SeshWsBridge.kt`** — a loopback **Java-WebSocket** server the WebView dials (no token); per
  connection it opens an **OkHttp** upstream WS to the hub, strips the renderer-only `__machine` param,
  and injects the token as `?token=`. Text + binary frames relayed (pi RPC JSON / xterm bytes).
- **`SeshStore.kt`** — host/port/fallback in SharedPreferences; the token encrypted with an AES-GCM key
  in the **AndroidKeyStore** (only IV+ciphertext persisted; key never exported; `getConfig` never
  returns it).
- **`public/sesh-native-bridge.js`** — a classic pre-bundle script wrapping the plugin into
  `window.SeshNative` (caches `wsBase` for the synchronous `seshClient.wsURL()`); no-op on web/Electron.
- **`network_security_config.xml`** — permits cleartext (the daemon is plain HTTP over Tailscale).
- Offline cache: **`src/lib/snapshot.svelte.js`** (gated to the android transport) + a loud staleness
  line on the App banner.

## Follow-ups (not blocking; same as desktop)
- **Cross-machine chat from the phone**: streaming is served against the hub only; a non-hub thread's
  chat shows the same gated notice as the web/desktop build (`peerInfo` reports no dial-able peers).
  The right fix is the sesh **hub-proxy** backlog item (the connected daemon proxies rpc/terminal +
  transcript to the owning peer) — do NOT hack per-daemon dialing into the client. See PLAN.md backlog.
- **macstudio fallback** still runs the older binary (HTTP works; its streaming would need a redeploy).
- **Release build / signing / Play-less install**: only the debug APK is built so far (`adb install`).
