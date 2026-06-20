package work.jackfruiting.seshui

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import java.util.concurrent.Executors

/**
 * The Android native bridge. Exposes the SAME shape as electron/preload.cjs's `window.sesh`
 * (get / post / wsBase / peerInfo / getConfig / setConfig), so seshClient.js's `android` branch
 * routes through it with NO renderer changes. The bearer token lives only here (Keystore via
 * [SeshStore]); the WebView never holds it — for HTTP it is attached in [SeshHttp], for WebSockets
 * it is injected upstream by [SeshWsBridge].
 *
 * A tiny JS shim (public/sesh-native-bridge.js) wraps this plugin into `window.SeshNative` and
 * caches `wsBase` (the loopback bridge address) so seshClient.wsURL() can stay synchronous.
 */
@CapacitorPlugin(name = "SeshNative")
class SeshNativePlugin : Plugin() {
    private lateinit var store: SeshStore
    private lateinit var http: SeshHttp
    private lateinit var wsBridge: SeshWsBridge
    private val io = Executors.newCachedThreadPool()

    override fun load() {
        store = SeshStore(context)
        http = SeshHttp(store)
        wsBridge = SeshWsBridge(store)
        try { wsBridge.start() } catch (e: Exception) { /* base stays "", surfaced when a chat opens */ }
    }

    @PluginMethod
    fun get(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path required")
        val machine = call.getString("machine") ?: ""
        io.execute { call.resolve(http.request("GET", path, null, machine)) }
    }

    @PluginMethod
    fun post(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path required")
        val body = call.getString("body") ?: "{}"
        val machine = call.getString("machine") ?: ""
        io.execute { call.resolve(http.request("POST", path, body, machine)) }
    }

    /** The loopback WS bridge base (ws://127.0.0.1:<port>); JS caches it for seshClient.wsURL(). */
    @PluginMethod
    fun getWsBase(call: PluginCall) {
        call.resolve(JSObject().apply { put("wsBase", wsBridge.base) })
    }

    /**
     * The connected hub's machine + the peers it can dial for cross-machine chat. Each peer the hub
     * reports with an `api_addr` (GET /v1/peers) is dial-able DIRECTLY from the phone over Tailscale
     * with the shared fleet-wide token, so we report it as dial-able and cache machine→api_addr for
     * SeshHttp / SeshWsBridge (mirrors the Electron peers.json path). ThreadsScreen then renders real
     * chat (rpc/terminal/transcript) for a remote thread instead of the gated notice.
     */
    @PluginMethod
    fun peerInfo(call: PluginCall) {
        io.execute {
            var connected: String? = null
            val st = http.request("GET", "/status", null, "")
            if (st.optBoolean("ok", false)) {
                try { connected = JSObject(st.getString("data")).getString("machine") } catch (_: Exception) {}
            }

            val peerMap = HashMap<String, String>()
            val pr = http.request("GET", "/peers", null, "")
            if (pr.optBoolean("ok", false)) {
                try {
                    val arr = JSObject(pr.getString("data")).getJSONArray("peers")
                    for (i in 0 until arr.length()) {
                        val p = arr.getJSONObject(i)
                        val m = p.optString("machine", "")
                        val addr = p.optString("api_addr", "")
                        if (m.isNotEmpty() && addr.isNotEmpty()) peerMap[m] = addr
                    }
                } catch (_: Exception) { /* older hub w/o /v1/peers → no dial-able peers */ }
            }
            store.setPeers(peerMap)

            val peersArr = JSONArray()
            for (m in peerMap.keys) peersArr.put(m)
            call.resolve(JSObject().apply {
                put("connected", connected)
                put("peers", peersArr)
            })
        }
    }

    /** Renderer-safe config view — NEVER the token value, only whether one is set (cf. publicConfig). */
    @PluginMethod
    fun getConfig(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("mode", "remote") // a phone has no local unix socket — always a remote hub
            put("target", if (store.host.isEmpty()) "" else "${store.host}:${store.port}")
            put("fallbackTarget", if (store.fallbackHost.isEmpty()) "" else "${store.fallbackHost}:${store.fallbackPort}")
            put("hasToken", store.token.isNotEmpty())
            put("editable", true)
            put("configured", store.configured)
        })
    }

    /** Persist a new endpoint (host/port [+ fallback]) and, if provided, the token (→ Keystore). */
    @PluginMethod
    fun setConfig(call: PluginCall) {
        store.host = call.getString("host")?.trim() ?: ""
        store.port = call.getString("port")?.trim()?.toIntOrNull() ?: SeshStore.DEFAULT_PORT
        // Fallback is optional and only updated when the keys are present (Android-only Settings fields).
        call.getString("fallbackHost")?.let { store.fallbackHost = it.trim() }
        call.getString("fallbackPort")?.let { store.fallbackPort = it.trim().toIntOrNull() ?: SeshStore.DEFAULT_PORT }
        // Token is write-only: only replace it when the user actually typed a new one.
        call.getString("token")?.let { if (it.isNotEmpty()) store.token = it }
        call.resolve()
    }
}
