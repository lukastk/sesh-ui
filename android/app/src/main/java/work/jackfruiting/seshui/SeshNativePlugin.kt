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
     * The connected hub's machine + the peers it can dial for cross-machine chat. The MVP streams
     * only against the hub itself, so we report NO dial-able peers: the UI then shows the same
     * cross-machine notice as the web build for a non-hub thread (never a silently wrong route).
     */
    @PluginMethod
    fun peerInfo(call: PluginCall) {
        io.execute {
            var connected: String? = null
            val st = http.request("GET", "/status", null, "")
            if (st.optBoolean("ok", false)) {
                try { connected = JSObject(st.getString("data")).getString("machine") } catch (_: Exception) {}
            }
            call.resolve(JSObject().apply {
                put("connected", connected)
                put("peers", JSONArray())
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
