package work.jackfruiting.seshui

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket as OkWebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.java_websocket.WebSocket as LbSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Loopback WebSocket bridge — the Android analogue of electron/transport.cjs `startWsBridge`.
 *
 * A WebView `new WebSocket()` cannot set the Authorization header and cannot inject the bearer
 * token without the token entering the WebView. So the WebView instead dials this LOOPBACK server
 * (ws://127.0.0.1:<port><path>, no token), and for each connection we open the UPSTREAM socket to
 * the configured hub daemon, INJECTING the token as `?token=` (the daemon accepts it on the
 * /v1/threads/{rpc,terminal} routes — see the sesh daemon change) and piping frames both ways.
 * The token is read from the Keystore here in native code; it never appears in the WebView.
 *
 * Text frames (pi RPC JSON) and binary frames (xterm terminal bytes) are both relayed, preserving
 * their type across the two WebSocket libraries (Java-WebSocket loopback ⇄ OkHttp upstream).
 */
class SeshWsBridge(private val store: SeshStore) {
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // long-lived streams: no read timeout
        .build()

    private var server: LoopbackServer? = null

    @Volatile
    var base: String = ""
        private set

    fun start() {
        if (server != null) return
        val srv = LoopbackServer(InetSocketAddress("127.0.0.1", 0))
        srv.isReuseAddr = true
        srv.isDaemon = true
        srv.start()
        // Java-WebSocket binds on its own thread; getPort() returns the OS-assigned port once bound.
        var p = -1
        var tries = 0
        while (p <= 0 && tries < 300) {
            p = srv.port
            if (p <= 0) Thread.sleep(10)
            tries++
        }
        server = srv
        base = "ws://127.0.0.1:$p"
    }

    fun stop() {
        try { server?.stop(500) } catch (_: Exception) {}
        server = null
    }

    private inner class LoopbackServer(addr: InetSocketAddress) : WebSocketServer(addr) {
        // loopback connection (from the WebView) → its upstream OkHttp socket (to the hub)
        private val upstreams = ConcurrentHashMap<LbSocket, OkWebSocket>()

        override fun onStart() {}

        override fun onOpen(conn: LbSocket, handshake: ClientHandshake) {
            val host = store.host
            val port = store.port
            val token = store.token
            if (host.isEmpty() || token.isEmpty()) {
                conn.close(1011, "sesh: no endpoint/token configured")
                return
            }
            val reqPath = stripMachineAndAddToken(handshake.resourceDescriptor, token)
            val req = Request.Builder().url("ws://$host:$port$reqPath").build()
            val upstream = client.newWebSocket(req, object : WebSocketListener() {
                override fun onMessage(webSocket: OkWebSocket, text: String) {
                    if (conn.isOpen) conn.send(text)
                }
                override fun onMessage(webSocket: OkWebSocket, bytes: ByteString) {
                    if (conn.isOpen) conn.send(bytes.toByteArray())
                }
                override fun onClosing(webSocket: OkWebSocket, code: Int, reason: String) {
                    closeLoopback(conn, code, reason)
                }
                override fun onClosed(webSocket: OkWebSocket, code: Int, reason: String) {
                    closeLoopback(conn, code, reason)
                }
                override fun onFailure(webSocket: OkWebSocket, t: Throwable, response: Response?) {
                    try { conn.close(1011, "sesh upstream: ${t.message}") } catch (_: Exception) {}
                    upstreams.remove(conn)
                }
            })
            upstreams[conn] = upstream
        }

        override fun onClose(conn: LbSocket, code: Int, reason: String?, remote: Boolean) {
            upstreams.remove(conn)?.let { try { it.close(1000, null) } catch (_: Exception) {} }
        }

        override fun onMessage(conn: LbSocket, message: String) {
            upstreams[conn]?.send(message)
        }

        override fun onMessage(conn: LbSocket, message: ByteBuffer) {
            val arr = ByteArray(message.remaining())
            message.get(arr)
            upstreams[conn]?.send(arr.toByteString())
        }

        override fun onError(conn: LbSocket?, ex: Exception) {
            if (conn != null) upstreams.remove(conn)?.let { try { it.close(1011, null) } catch (_: Exception) {} }
        }

        private fun closeLoopback(conn: LbSocket, code: Int, reason: String) {
            try { conn.close(if (code in 1000..4999) code else 1000, reason) } catch (_: Exception) {
                try { conn.close() } catch (_: Exception) {}
            }
            upstreams.remove(conn)
        }
    }

    /**
     * Rewrite the WebView's request resource ("/v1/threads/rpc?id=…&__machine=…") into the upstream
     * path: drop the renderer-only `__machine` param and append the bearer token as `?token=`.
     */
    private fun stripMachineAndAddToken(resource: String, token: String): String {
        val qIdx = resource.indexOf('?')
        val tokenParam = "token=" + URLEncoder.encode(token, "UTF-8")
        if (qIdx < 0) return "$resource?$tokenParam"
        val path = resource.substring(0, qIdx)
        val kept = resource.substring(qIdx + 1)
            .split('&')
            .filter { it.isNotEmpty() && !it.startsWith("__machine=") }
            .toMutableList()
        kept.add(tokenParam)
        return "$path?${kept.joinToString("&")}"
    }
}
