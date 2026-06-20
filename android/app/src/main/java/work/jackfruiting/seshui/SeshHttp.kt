package work.jackfruiting.seshui

import com.getcapacitor.JSObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Native HTTP to the hub daemon's TCP API — the Android analogue of electron/transport.cjs
 * `request()`. The bearer token is attached HERE, in native code (read from the Keystore-backed
 * [SeshStore]); the WebView never sees it. CapacitorHttp / WebView fetch are deliberately NOT used,
 * because the daemon sends no CORS headers and a WebView request would need the token in JS.
 *
 * Result shape mirrors Electron's structured result so a 4xx surfaces as a thrown Error with
 * .status in the renderer (the loud-error contract), never a silent empty value:
 *   { ok:true,  data:<raw response body string> }
 *   { ok:false, error:<message>, status:<http status or 0 for a transport error> }
 *
 * Endpoint failover: a TRANSPORT error (host unreachable) falls back to the secondary endpoint; an
 * HTTP response (2xx/4xx/5xx) is a definitive answer from a reachable daemon and is returned as-is
 * (we never mask a real daemon error by retrying elsewhere).
 */
class SeshHttp(private val store: SeshStore) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    fun request(method: String, path: String, body: String?, machine: String): JSObject {
        // `machine` is the cross-machine-chat target. The MVP streams/serves only against the
        // configured hub; a non-hub machine is surfaced as the same gated notice the web build
        // shows (peerInfo reports no dial-able peers), so we never silently mis-route a request.
        val endpoints = endpoints()
        if (endpoints.isEmpty()) return err("$path: no endpoint configured — open Settings", 0)
        val token = store.token
        if (token.isEmpty()) return err("$path: no token configured — open Settings", 0)

        var lastErr = "$path: unreachable"
        for ((host, port) in endpoints) {
            try {
                val builder = Request.Builder()
                    .url("http://$host:$port/v1$path")
                    .header("Authorization", "Bearer $token")
                if (method == "POST") {
                    builder.post((body ?: "{}").toRequestBody(jsonMedia))
                } else {
                    builder.get()
                }
                client.newCall(builder.build()).execute().use { resp ->
                    val text = resp.body?.string() ?: ""
                    return if (resp.isSuccessful) ok(text) else err("$path: ${resp.code} $text", resp.code)
                }
            } catch (e: Exception) {
                lastErr = "$path: ${e.message}" // transport error → try the next endpoint
            }
        }
        return err(lastErr, 0)
    }

    /** Primary then fallback (each only if it has a host). */
    private fun endpoints(): List<Pair<String, Int>> {
        val list = ArrayList<Pair<String, Int>>()
        if (store.host.isNotEmpty()) list.add(store.host to store.port)
        if (store.fallbackHost.isNotEmpty()) list.add(store.fallbackHost to store.fallbackPort)
        return list
    }

    private fun ok(data: String) = JSObject().apply { put("ok", true); put("data", data) }
    private fun err(msg: String, status: Int) =
        JSObject().apply { put("ok", false); put("error", msg); put("status", status) }
}
