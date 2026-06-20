# sesh-ui on Android (Phase 3) — design + status

**Status: APK builds with the full native transport; on-phone verification pending wifi pairing.**
Built on **macbook** (JDK 17 Temurin + Android SDK android-34/build-tools 34, set via `ANDROID_HOME`;
Gradle 8.2.1 wrapper). The same Svelte build runs unchanged; the only new surface is the native
transport (the `android/` Capacitor project + the `SeshNative` Kotlin plugin). `./gradlew assembleDebug`
produces `android/app/build/outputs/apk/debug/app-debug.apk`.

**Hub daemon: mymain:7878** (Tailscale 100.106.17.33), rebuilt from origin/main `5fd5157` — serves the
`?token=` WS auth + `/v1/peers` (schema 22). Fallback: macstudio:7878 (100.125.115.38, still on the
older binary — HTTP works, streaming would need its redeploy). Token: `~/.sesh/api-token` on macbook.
Phone: android-main (Pixel 9, 100.67.70.114). **Set the endpoint + token on-device in Settings** (the
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
