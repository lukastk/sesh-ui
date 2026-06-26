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

**Hub daemon: mymain:7878**, serving the `?token=` WS auth + `/v1/peers` (schema 22); the rest of the
fleet (macbook, macstudio) is also on schema 22, so any of them can be the hub or a dial-able peer.
Token: the shared fleet-wide `SESH_API_TOKEN` (`~/.sesh/api-token`). Phone: android-main (Pixel 9).
**Set the endpoint (hub host:port, + optional fallback) + token on-device in Settings** (the token is
entered at runtime → Keystore; it is NEVER baked into the committed app — no IPs/tokens in the repo).

**Cross-machine chat (native peer-dialing):** the phone is on Tailscale and the token is identical
fleet-wide, so a thread on a NON-hub machine is chatted with by dialing that machine's `api_addr`
DIRECTLY. `peerInfo()` discovers dial-able peers from the hub's `GET /v1/peers` (each peer with an
`api_addr`); `SeshHttp` dials the peer's `api_addr` for that thread's transcript/verbs, and
`SeshWsBridge` points the upstream rpc/terminal WS at the peer's `api_addr` (with `?token=`). Mirrors
the Electron peers.json path — no daemon change. ThreadsScreen then renders real chat for a remote
thread instead of the gated notice.

**Image/file attach:** Capacitor's `BridgeWebChromeClient` already wires `<input type=file>` to the
system picker (ACTION_GET_CONTENT), so the composer 📎 opens the gallery/files; `READ_MEDIA_IMAGES`
is declared for gallery reads. The base64 upload → blob store goes over the native transport via the
shared `src/lib/blobs.js` (no Android-specific JS).

## Build + install (the everyday loop)

**`./scripts/install-android.sh`** (= `npm run android:install`) is the one-command push-to-phone:
`vite build` → `cap sync android` → `gradlew assembleDebug` → `adb install -r` over Tailscale. Run it
**on macbook** (the box with the JDK + Android SDK — the Linux hub has only `adb`, no toolchain, so it
can't build). Flags: `-n/--no-build` (reinstall the existing APK), `-l/--launch` (open the app after),
`--host H`, `--port P`.

```bash
cd ~/mysetup/sesh-ui && ./scripts/install-android.sh          # build + push to android-main
./scripts/install-android.sh -n --port <connectPort> --launch # reinstall existing APK + open it
```

**Wireless-debugging connection.** Pairing (pairing port + 6-digit code, from the phone's *Wireless
debugging* screen) is a persistent one-time step; the **connect port rotates** on reboot / toggling WD,
so the script tries the saved port first and only drops into the pair flow when it can't connect. It
caches the working `host:port` in `scripts/.android-target.local` (gitignored) and **bails loudly** if
run without a terminal to prompt on (CI/SSH/nohup). Same-wifi tip: `adb mdns services` shows the phone's
current `_adb-tls-connect` port; over Tailscale-only, read the port off the phone screen.

**Signing keeps the token alive.** The debug keystore (`~/.android/debug.keystore`) signs every build, so
`adb install -r` upgrades in place and the on-device endpoint+token (Keystore, keyed to the app's signing
identity) survive. An APK signed by a *different* key forces an uninstall → wipes the token, which is why
we build+push locally rather than pulling a CI APK.

### One-time connection config (per app-id, NOT per install)

The endpoint+token are entered **on-device** (the token is encrypted into the Keystore on the phone — it
can never be baked off-device). This persists across in-place reinstalls, so it's a once-ever step you
only redo after an **app-id change** or a clear-data/uninstall. On the phone: **Settings → Connection →
Endpoint = Remote (TCP)** → Host `mymain` (or the Tailscale IP) · Port `7878` · Token = the fleet
`SESH_API_TOKEN` (on the hub at `~/.sesh/api-token`). The app id is **`dev.lukastk.seshui`** (renamed
from the unrelated `work.jackfruiting.seshui` startup namespace — a fresh app, so the old one was
uninstalled).

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

## How it's implemented (`android/app/src/main/java/dev/lukastk/seshui/`)

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

- **Cross-machine peer-dialing**: `SeshStore` holds an in-memory machine→`api_addr` map (set by
  `peerInfo()` from `/v1/peers`); `SeshHttp` and `SeshWsBridge` dial the peer's `api_addr` directly
  for a requested `machine`, with the shared fleet-wide token. Unlike Electron (which reads
  `peers.json`), the phone discovers peers from the hub — no local peers file.

## Follow-ups (not blocking; same as desktop)
- **Release build / signing / Play-less install**: only the debug APK is built so far (`adb install`).
