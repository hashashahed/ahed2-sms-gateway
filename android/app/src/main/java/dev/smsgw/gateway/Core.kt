package dev.smsgw.gateway

import android.content.Context
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedQueue

/** Saved pairing and settings. */
object Prefs {
    private fun p(ctx: Context) = ctx.getSharedPreferences("gateway", Context.MODE_PRIVATE)

    fun server(ctx: Context): String = p(ctx).getString("server", "") ?: ""
    fun token(ctx: Context): String = p(ctx).getString("token", "") ?: ""
    fun isPaired(ctx: Context) = server(ctx).isNotBlank() && token(ctx).isNotBlank()

    fun savePairing(ctx: Context, server: String, token: String) {
        p(ctx).edit().putString("server", server.trimEnd('/')).putString("token", token).apply()
    }

    fun isEnabled(ctx: Context): Boolean = p(ctx).getBoolean("enabled", false)
    fun setEnabled(ctx: Context, v: Boolean) { p(ctx).edit().putBoolean("enabled", v).apply() }

    /** Pause between messages, so Android and the carrier don't flag the phone for spam. */
    fun delayMs(ctx: Context): Long = p(ctx).getLong("delay_ms", 2000L)
}

/** Frames waiting to reach the server. Survives disconnects while the app process is alive. */
object Outbox {
    val queue = ConcurrentLinkedQueue<String>()

    fun push(frame: JSONObject) {
        queue.add(frame.toString())
        GatewayService.instance?.flushOutbox()
    }

    fun status(id: String, status: String, error: String? = null) {
        val o = JSONObject().put("type", "status").put("id", id).put("status", status)
        if (error != null) o.put("error", error)
        push(o)
    }
}

/** Small in-memory activity log shown on the main screen. */
object AppLog {
    private val lines = ArrayDeque<String>()
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.US)

    @Volatile
    var listener: (() -> Unit)? = null

    fun add(line: String) {
        synchronized(lines) {
            lines.addFirst("${fmt.format(Date())}  $line")
            while (lines.size > 60) lines.removeLast()
        }
        listener?.invoke()
    }

    fun text(): String = synchronized(lines) { lines.joinToString("\n") }
}
