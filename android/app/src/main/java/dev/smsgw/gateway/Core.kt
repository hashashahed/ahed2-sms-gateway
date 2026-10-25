package dev.smsgw.gateway

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedQueue

/** Pairing and user settings. The settings screen writes to the same file. */
object Prefs {
    const val FILE = "gateway"

    fun p(ctx: Context): SharedPreferences = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    // ----- pairing -----
    fun server(ctx: Context): String = p(ctx).getString("server", "") ?: ""
    fun token(ctx: Context): String = p(ctx).getString("token", "") ?: ""
    fun isPaired(ctx: Context) = server(ctx).isNotBlank() && token(ctx).isNotBlank()

    fun savePairing(ctx: Context, server: String, token: String) {
        p(ctx).edit()
            .putString("server", server.trimEnd('/'))
            .putString("token", token)
            .putString("device_name", "")
            .apply()
    }

    fun clearPairing(ctx: Context) {
        p(ctx).edit().remove("server").remove("token").remove("device_name").putBoolean("enabled", false).apply()
    }

    fun deviceName(ctx: Context): String = p(ctx).getString("device_name", "") ?: ""
    fun setDeviceName(ctx: Context, name: String) { p(ctx).edit().putString("device_name", name).apply() }

    fun isEnabled(ctx: Context): Boolean = p(ctx).getBoolean("enabled", false)
    fun setEnabled(ctx: Context, v: Boolean) { p(ctx).edit().putBoolean("enabled", v).apply() }

    // ----- settings (keys match res/xml/settings.xml) -----
    fun delayMs(ctx: Context): Long =
        ((p(ctx).getString("delay_s", "2") ?: "2").toLongOrNull() ?: 2L).coerceIn(1L, 60L) * 1000L

    /** null = let Android pick the default SMS SIM. */
    fun defaultSim(ctx: Context): Int? = (p(ctx).getString("default_sim", "auto") ?: "auto").toIntOrNull()

    /** 0 = no limit. */
    fun hourlyLimit(ctx: Context): Int = (p(ctx).getString("hourly_limit", "0") ?: "0").toIntOrNull() ?: 0

    fun deliveryReports(ctx: Context) = p(ctx).getBoolean("delivery_reports", true)
    fun forwardIncoming(ctx: Context) = p(ctx).getBoolean("forward_incoming", true)
    fun startOnBoot(ctx: Context) = p(ctx).getBoolean("start_on_boot", true)
    fun keepAwake(ctx: Context) = p(ctx).getBoolean("keep_awake", true)
}

/** Today's counters shown on the main screen. They reset at midnight. */
object Stats {
    const val SENT = "stat_sent"
    const val FAILED = "stat_failed"
    const val RECEIVED = "stat_received"

    private fun today() = SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())

    @Synchronized
    fun inc(ctx: Context, key: String) {
        val p = Prefs.p(ctx)
        val day = today()
        val e = p.edit()
        val current = if (p.getString("stat_day", "") == day) p.getInt(key, 0) else {
            e.putString("stat_day", day).putInt(SENT, 0).putInt(FAILED, 0).putInt(RECEIVED, 0)
            0
        }
        e.putInt(key, current + 1).apply()
    }

    fun get(ctx: Context, key: String): Int {
        val p = Prefs.p(ctx)
        return if (p.getString("stat_day", "") == today()) p.getInt(key, 0) else 0
    }
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
            while (lines.size > 80) lines.removeLast()
        }
        listener?.invoke()
    }

    fun clear() {
        synchronized(lines) { lines.clear() }
        listener?.invoke()
    }

    fun text(): String = synchronized(lines) { lines.joinToString("\n") }
}
