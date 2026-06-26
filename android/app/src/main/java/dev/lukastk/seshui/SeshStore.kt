package dev.lukastk.seshui

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Connection config for the Android transport: which hub daemon to talk to (primary + fallback
 * host:port) and the bearer token. This is the Android analogue of electron/config.cjs.
 *
 * The token is the ONLY secret. It is encrypted with an AES-GCM key that lives in the
 * AndroidKeyStore (hardware-backed where the device supports it) and never leaves it — only the
 * IV+ciphertext (base64) is persisted in SharedPreferences, and the plaintext token is NEVER
 * exposed to the WebView (getConfig reports only whether a token is set, exactly like Electron's
 * publicConfig). host/port are not secret, so they are stored in the clear.
 */
class SeshStore(context: Context) {
    private val prefs = context.getSharedPreferences("sesh_config", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_ALIAS = "sesh_token_key"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val GCM_TAG_BITS = 128
        private const val GCM_IV_BYTES = 12 // AndroidKeyStore AES-GCM uses a 12-byte IV
        const val DEFAULT_PORT = 7878
    }

    var host: String
        get() = prefs.getString("host", "") ?: ""
        set(v) { prefs.edit().putString("host", v).apply() }
    var port: Int
        get() = prefs.getInt("port", DEFAULT_PORT)
        set(v) { prefs.edit().putInt("port", v).apply() }
    var fallbackHost: String
        get() = prefs.getString("fb_host", "") ?: ""
        set(v) { prefs.edit().putString("fb_host", v).apply() }
    var fallbackPort: Int
        get() = prefs.getInt("fb_port", DEFAULT_PORT)
        set(v) { prefs.edit().putInt("fb_port", v).apply() }

    /** The bearer token, decrypted on read / encrypted on write via the Keystore key. "" if unset. */
    var token: String
        get() {
            val blob = prefs.getString("token_enc", null) ?: return ""
            return try { decrypt(blob) } catch (e: Exception) { "" }
        }
        set(v) {
            if (v.isEmpty()) { prefs.edit().remove("token_enc").apply(); return }
            prefs.edit().putString("token_enc", encrypt(v)).apply()
        }

    /** Has the user picked a hub + token? Drives the first-run "configure your connection" UX. */
    val configured: Boolean get() = host.isNotEmpty() && token.isNotEmpty()

    // ── Dial-able peers (cross-machine chat) ────────────────────────────────────────────────
    // In-memory map machine → api_addr ("host:port"), discovered from the hub's GET /v1/peers by
    // peerInfo(). NOT persisted — it's re-fetched each session. A thread on a peer machine is dialed
    // DIRECTLY at its api_addr over Tailscale with the SAME fleet-wide token (the Electron transport
    // does the equivalent from peers.json). Volatile: written on a poll thread, read on request/WS threads.
    @Volatile
    private var peers: Map<String, String> = emptyMap()

    fun setPeers(p: Map<String, String>) { peers = p }
    /** The api_addr ("host:port") to dial for a peer machine, or null if not a dial-able peer. */
    fun peerAddr(machine: String?): String? = if (machine.isNullOrEmpty()) null else peers[machine]

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        kg.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return kg.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val out = ByteArray(iv.size + ct.size)
        System.arraycopy(iv, 0, out, 0, iv.size)
        System.arraycopy(ct, 0, out, iv.size, ct.size)
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun decrypt(blob: String): String {
        val data = Base64.decode(blob, Base64.NO_WRAP)
        val iv = data.copyOfRange(0, GCM_IV_BYTES)
        val ct = data.copyOfRange(GCM_IV_BYTES, data.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }
}
