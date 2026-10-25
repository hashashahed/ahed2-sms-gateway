package dev.smsgw.gateway

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.telephony.SubscriptionManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Keeps a WebSocket open to the server, receives "send" jobs and sends them as SMS,
 * and reports status and incoming messages back.
 */
class GatewayService : Service() {

    companion object {
        private const val CHANNEL_ID = "gateway"
        private const val NOTIFICATION_ID = 1
        private const val HOUR_MS = 3_600_000L

        const val STATE_STOPPED = "stopped"
        const val STATE_CONNECTING = "connecting"
        const val STATE_CONNECTED = "connected"
        const val STATE_UNAUTHORIZED = "unauthorized"
        const val STATE_UNPAIRED = "unpaired"

        @Volatile
        var instance: GatewayService? = null
            private set

        @Volatile
        var state: String = STATE_STOPPED
            private set

        @Volatile
        var stateListener: ((String) -> Unit)? = null

        private fun setState(s: String) {
            state = s
            stateListener?.invoke(s)
        }

        fun start(ctx: Context) {
            Prefs.setEnabled(ctx, true)
            ctx.startForegroundService(Intent(ctx, GatewayService::class.java))
        }

        fun stop(ctx: Context) {
            Prefs.setEnabled(ctx, false)
            ctx.stopService(Intent(ctx, GatewayService::class.java))
        }

        /** Messages accepted from the server but not handed to Android yet. */
        val queued = AtomicInteger(0)
    }

    private val main = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .build()

    @Volatile private var ws: WebSocket? = null
    @Volatile private var connected = false
    @Volatile private var stopped = false
    private var backoffMs = 2_000L

    private val sender: ExecutorService = Executors.newSingleThreadExecutor()
    // Only touched from the sender thread.
    private val sendTimes = ArrayDeque<Long>()
    // Remembers recent job ids, so a job the server re-sends after a reconnect is never sent twice.
    private val seen = object : LinkedHashMap<String, Boolean>(256, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>?) = size > 2000
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val reconnect = Runnable { if (!stopped && ws == null) connect() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        queued.set(0)
        createChannel()
        startInForeground(getString(R.string.notif_connecting))
        refreshWakeLock()

        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                main.post {
                    if (!stopped && !connected) {
                        main.removeCallbacks(reconnect)
                        backoffMs = 2_000L
                        if (ws == null) connect()
                    }
                }
            }
        }
        (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).registerDefaultNetworkCallback(cb)
        networkCallback = cb
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        stopped = false
        if (ws == null) connect()
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        ws?.close(1000, "stopped")
        ws = null
        connected = false
        networkCallback?.let {
            runCatching { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it) }
        }
        wakeLock?.let { if (it.isHeld) it.release() }
        sender.shutdownNow()
        queued.set(0)
        instance = null
        if (state != STATE_UNAUTHORIZED) setState(STATE_STOPPED)
        AppLog.add(getString(R.string.log_stopped))
        super.onDestroy()
    }

    /** Holds or releases the CPU wake lock to match the "keep awake" setting. */
    fun refreshWakeLock() {
        if (Prefs.keepAwake(this)) {
            val lock = wakeLock ?: (getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ahedsms:gateway")
                .also { it.setReferenceCounted(false); wakeLock = it }
            if (!lock.isHeld) lock.acquire()
        } else {
            wakeLock?.let { if (it.isHeld) it.release() }
        }
    }

    // ---------- connection ----------

    private fun connect() {
        val server = Prefs.server(this)
        val token = Prefs.token(this)
        if (server.isBlank() || token.isBlank()) {
            setState(STATE_UNPAIRED)
            stopSelf()
            return
        }
        val url = server.trimEnd('/').replaceFirst("http", "ws") + "/ws/device"
        setState(STATE_CONNECTING)
        updateNotification(getString(R.string.notif_connecting))

        val request = try {
            Request.Builder().url(url).header("Authorization", "Bearer $token").build()
        } catch (e: IllegalArgumentException) {
            AppLog.add(getString(R.string.log_bad_server, server))
            setState(STATE_UNPAIRED)
            stopSelf()
            return
        }
        ws = client.newWebSocket(request, Listener())
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            main.post {
                if (webSocket !== ws) return@post
                connected = true
                backoffMs = 2_000L
                setState(STATE_CONNECTED)
                updateNotification(getString(R.string.notif_connected))
                AppLog.add(getString(R.string.log_connected))
                webSocket.send(hello().toString())
                flushOutbox()
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            handle(text)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            main.post { onDisconnected(webSocket, code, reason) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            val code = if (response?.code == 401) 401 else -1
            main.post { onDisconnected(webSocket, code, t.message ?: t.javaClass.simpleName) }
        }
    }

    private fun onDisconnected(socket: WebSocket, code: Int, reason: String) {
        if (socket !== ws) return
        ws = null
        val wasConnected = connected
        connected = false

        // 401 = bad token, 4001 = token replaced from dashboard, 4003 = device deleted or account suspended.
        if (code == 401 || code == 4001 || code == 4003) {
            AppLog.add(getString(R.string.log_unauthorized))
            setState(STATE_UNAUTHORIZED)
            Prefs.setEnabled(this, false)
            stopSelf()
            return
        }
        if (stopped) return

        if (wasConnected) AppLog.add(getString(R.string.log_disconnected, reason))
        setState(STATE_CONNECTING)
        updateNotification(getString(R.string.notif_reconnecting))
        main.removeCallbacks(reconnect)
        main.postDelayed(reconnect, backoffMs)
        backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
    }

    @Synchronized
    fun flushOutbox() {
        val socket = ws ?: return
        if (!connected) return
        while (true) {
            val frame = Outbox.queue.peek() ?: break
            if (!socket.send(frame)) break
            Outbox.queue.poll()
        }
    }

    @SuppressLint("MissingPermission")
    private fun hello(): JSONObject {
        val info = JSONObject()
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("android", Build.VERSION.SDK_INT)
            .put("app", appVersion())
        if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
            runCatching {
                getSystemService(SubscriptionManager::class.java)?.let { info.put("sims", it.activeSubscriptionInfoCount) }
            }
        }
        return JSONObject().put("type", "hello").put("info", info)
    }

    private fun appVersion(): String =
        runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: "?"

    // ---------- jobs ----------

    private fun handle(text: String) {
        val o = try { JSONObject(text) } catch (e: Exception) { return }
        when (o.optString("type")) {
            "welcome" -> {
                val name = o.optString("name")
                Prefs.setDeviceName(this, name)
                AppLog.add(getString(R.string.log_welcome, name))
                main.post { stateListener?.invoke(state) }
            }
            "send" -> {
                val id = o.optString("id")
                val to = o.optString("to")
                val body = o.optString("body")
                if (id.isEmpty() || to.isEmpty()) return
                val simSlot = if (o.has("simSlot") && !o.isNull("simSlot")) o.optInt("simSlot") else null

                val duplicate = synchronized(seen) {
                    if (seen.containsKey(id)) true else { seen[id] = true; false }
                }
                Outbox.push(JSONObject().put("type", "accepted").put("id", id))
                if (duplicate) return

                val ctx = applicationContext
                queued.incrementAndGet()
                main.post { stateListener?.invoke(state) }
                runCatching {
                    sender.execute {
                        try {
                            waitForHourlySlot()
                            SmsSender.send(ctx, id, to, body, simSlot)
                            Thread.sleep(Prefs.delayMs(ctx))
                        } catch (e: InterruptedException) {
                            return@execute
                        } finally {
                            queued.decrementAndGet()
                            main.post { stateListener?.invoke(state) }
                        }
                    }
                }.onFailure { queued.decrementAndGet() }
            }
        }
    }

    /** Blocks the sender thread while the per-hour limit from settings is reached. */
    private fun waitForHourlySlot() {
        var logged = false
        while (true) {
            val limit = Prefs.hourlyLimit(this)
            val now = System.currentTimeMillis()
            while (sendTimes.isNotEmpty() && now - sendTimes.peekFirst()!! > HOUR_MS) sendTimes.pollFirst()
            if (limit <= 0 || sendTimes.size < limit) {
                sendTimes.addLast(now)
                return
            }
            val waitMs = HOUR_MS - (now - sendTimes.peekFirst()!!) + 500
            if (!logged) {
                AppLog.add(getString(R.string.log_hourly_wait, ((waitMs / 60_000L) + 1).toInt()))
                logged = true
            }
            Thread.sleep(waitMs.coerceAtMost(60_000L))
        }
    }

    // ---------- notification ----------

    private fun createChannel() {
        val ch = NotificationChannel(CHANNEL_ID, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW)
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(open)
            .setColor(getColor(R.color.brand))
            .setOngoing(true)
            .build()
    }

    private fun startInForeground(text: String) {
        val n = buildNotification(text)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }

    private fun updateNotification(text: String) {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }
}
