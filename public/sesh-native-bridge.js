// sesh-native-bridge — Android (Capacitor) ONLY. Loaded as a classic script BEFORE the Svelte
// module bundle (see index.html), so that seshClient.js sees window.SeshNative at import time and
// selects the `android` transport. No-op on web/dev and Electron (no Capacitor native platform),
// so it is safe to ship in every build.
//
// It wraps the native SeshNative Capacitor plugin (android/app/.../SeshNativePlugin.kt) into the
// SAME shape as electron/preload.cjs's window.sesh: get / post / wsBase / peerInfo / getConfig /
// setConfig. The bearer token lives only in the native plugin (Android Keystore) — it never
// appears here, exactly as it never appears in the Electron renderer.
;(function () {
  var cap = window.Capacitor
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return // web / Electron
  var plugin = (cap.Plugins && cap.Plugins.SeshNative) ||
    (typeof cap.registerPlugin === 'function' && cap.registerPlugin('SeshNative'))
  if (!plugin) { console.error('[sesh] native platform but SeshNative plugin missing'); return }

  // The native get/post return a structured result { ok, data } | { ok:false, error, status } —
  // same contract as Electron — so a 4xx surfaces as a thrown Error with .status (the renderer's
  // loud-error contract), never a silent empty value. `data` is the raw JSON body string.
  function unwrap(r) {
    if (r && r.ok) return typeof r.data === 'string' ? JSON.parse(r.data) : r.data
    var err = new Error((r && r.error) || 'sesh request failed')
    err.status = r && r.status
    throw err
  }

  var bridge = {
    // ws:// base of the native loopback bridge; filled async below, read synchronously by wsURL().
    wsBase: '',
    get: function (path, machine) { return plugin.get({ path: path, machine: machine || '' }).then(unwrap) },
    post: function (path, body, machine) {
      return plugin.post({ path: path, body: JSON.stringify(body == null ? {} : body), machine: machine || '' }).then(unwrap)
    },
    peerInfo: function () { return plugin.peerInfo() },
    getConfig: function () { return plugin.getConfig() },
    setConfig: function (cfg) { return plugin.setConfig(cfg || {}) },
  }
  window.SeshNative = bridge

  // The native loopback WS bridge starts at plugin load(); fetch its base once and cache it so
  // seshClient.wsURL() (called later, when a chat surface opens) can stay synchronous.
  plugin.getWsBase()
    .then(function (r) { bridge.wsBase = (r && r.wsBase) || '' })
    .catch(function (e) { console.error('[sesh] getWsBase failed', e) })
})()
