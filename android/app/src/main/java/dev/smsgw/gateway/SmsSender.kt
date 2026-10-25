package dev.smsgw.gateway

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import android.telephony.SmsManager
import android.telephony.SmsMessage
import android.telephony.SubscriptionManager
import org.json.JSONObject

object SmsSender {
    const val ACTION_SENT = "dev.smsgw.gateway.SMS_SENT"
    const val ACTION_DELIVERED = "dev.smsgw.gateway.SMS_DELIVERED"

    /** Sends one message. simSlot null = use the default SIM from settings. */
    fun send(ctx: Context, id: String, to: String, body: String, simSlot: Int?) {
        try {
            val mgr = manager(ctx, simSlot ?: Prefs.defaultSim(ctx))
            val parts = mgr.divideMessage(body)
            if (parts.isEmpty()) parts.add(body)
            SmsTracker.start(id, parts.size)

            val wantReports = Prefs.deliveryReports(ctx)
            val sent = ArrayList<PendingIntent>()
            val delivered = ArrayList<PendingIntent>()
            for (i in parts.indices) {
                val last = i == parts.lastIndex
                sent.add(pendingIntent(ctx, ACTION_SENT, id, i, last, mutable = false))
                // Delivery reports carry the PDU as an extra the system fills in, so that intent must be mutable.
                if (wantReports) delivered.add(pendingIntent(ctx, ACTION_DELIVERED, id, i, last, mutable = true))
            }

            if (parts.size == 1) {
                mgr.sendTextMessage(to, null, parts[0], sent[0], if (wantReports) delivered[0] else null)
            } else {
                mgr.sendMultipartTextMessage(to, null, parts, sent, if (wantReports) delivered else null)
            }
            AppLog.add(ctx.getString(R.string.log_sending, to, parts.size))
        } catch (e: Exception) {
            SmsTracker.clear(id)
            val err = "${e.javaClass.simpleName}: ${e.message ?: ""}".trim()
            AppLog.add(ctx.getString(R.string.log_send_failed, to, err))
            Stats.inc(ctx, Stats.FAILED)
            Outbox.status(id, "failed", err)
        }
    }

    @Suppress("DEPRECATION")
    private fun manager(ctx: Context, simSlot: Int?): SmsManager {
        val subId = simSlot?.let { subscriptionForSlot(ctx, it) }
        return if (Build.VERSION.SDK_INT >= 31) {
            val base = ctx.getSystemService(SmsManager::class.java)
                ?: throw IllegalStateException("SMS is not supported on this device")
            if (subId != null) base.createForSubscriptionId(subId) else base
        } else {
            if (subId != null) SmsManager.getSmsManagerForSubscriptionId(subId) else SmsManager.getDefault()
        }
    }

    @SuppressLint("MissingPermission")
    private fun subscriptionForSlot(ctx: Context, slot: Int): Int? {
        if (ctx.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return null
        return try {
            ctx.getSystemService(SubscriptionManager::class.java)
                ?.getActiveSubscriptionInfoForSimSlotIndex(slot)?.subscriptionId
        } catch (e: SecurityException) {
            null
        }
    }

    private fun pendingIntent(ctx: Context, action: String, id: String, part: Int, last: Boolean, mutable: Boolean): PendingIntent {
        val intent = Intent(ctx, SmsStatusReceiver::class.java)
            .setAction(action)
            // Unique data URI, so each part gets its own PendingIntent instead of reusing an older one.
            .setData(Uri.parse("smsgw://status/$action/$id/$part"))
            .putExtra("id", id)
            .putExtra("last", last)
        val mutability = when {
            !mutable -> PendingIntent.FLAG_IMMUTABLE
            Build.VERSION.SDK_INT >= 31 -> PendingIntent.FLAG_MUTABLE
            else -> 0 // mutable by default before Android 12
        }
        return PendingIntent.getBroadcast(ctx, 0, intent, PendingIntent.FLAG_ONE_SHOT or mutability)
    }

    fun errorName(code: Int): String = when (code) {
        SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "GENERIC_FAILURE"
        SmsManager.RESULT_ERROR_RADIO_OFF -> "RADIO_OFF"
        SmsManager.RESULT_ERROR_NULL_PDU -> "NULL_PDU"
        SmsManager.RESULT_ERROR_NO_SERVICE -> "NO_SERVICE"
        SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> "LIMIT_EXCEEDED"
        SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED -> "SHORT_CODE_NOT_ALLOWED"
        SmsManager.RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED -> "SHORT_CODE_NEVER_ALLOWED"
        else -> "ERROR_$code"
    }
}

/** Counts the "sent" callback of every part and reports once all parts are done. */
object SmsTracker {
    private class Pending(var remaining: Int, var error: String? = null)
    private val map = HashMap<String, Pending>()

    @Synchronized fun start(id: String, parts: Int) { map[id] = Pending(parts) }
    @Synchronized fun clear(id: String) { map.remove(id) }

    /** Returns (status, error) when the message is finished, or null while parts are still pending. */
    @Synchronized
    fun partResult(id: String, error: String?): Pair<String, String?>? {
        val p = map[id] ?: return if (error == null) "sent" to null else "failed" to error
        if (error != null && p.error == null) p.error = error
        p.remaining--
        if (p.remaining > 0) return null
        map.remove(id)
        return if (p.error == null) "sent" to null else "failed" to p.error
    }
}

class SmsStatusReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        when (intent.action) {
            SmsSender.ACTION_SENT -> {
                val err = if (resultCode == Activity.RESULT_OK) null else SmsSender.errorName(resultCode)
                val (status, error) = SmsTracker.partResult(id, err) ?: return
                if (status == "sent") {
                    Stats.inc(ctx, Stats.SENT)
                    AppLog.add(ctx.getString(R.string.log_sent))
                } else {
                    Stats.inc(ctx, Stats.FAILED)
                    AppLog.add(ctx.getString(R.string.log_failed, error ?: "?"))
                }
                Outbox.status(id, status, error)
            }
            SmsSender.ACTION_DELIVERED -> {
                if (!intent.getBooleanExtra("last", false)) return
                val pdu = intent.getByteArrayExtra("pdu")
                val format = intent.getStringExtra("format")
                if (pdu != null) {
                    val st = runCatching { SmsMessage.createFromPdu(pdu, format).status }.getOrNull() ?: 0
                    if (format == "3gpp") {
                        // GSM TP-Status: 0x00-0x1F done, 0x20-0x3F still trying, 0x40+ failed.
                        if (st >= 0x40) { Outbox.status(id, "failed", "DELIVERY_FAILED_$st"); return }
                        if (st >= 0x20) return
                    } else if (st != 0) {
                        return
                    }
                } else if (resultCode != Activity.RESULT_OK) {
                    return
                }
                AppLog.add(ctx.getString(R.string.log_delivered))
                Outbox.status(id, "delivered")
            }
        }
    }
}

class SmsIncomingReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!Prefs.forwardIncoming(ctx) || !Prefs.isPaired(ctx)) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (messages.isEmpty()) return

        // Long messages arrive in several parts; join them per sender.
        val bySender = LinkedHashMap<String, StringBuilder>()
        var timestamp = System.currentTimeMillis()
        for (m in messages) {
            val from = m.displayOriginatingAddress ?: m.originatingAddress ?: continue
            bySender.getOrPut(from) { StringBuilder() }.append(m.displayMessageBody ?: m.messageBody ?: "")
            timestamp = m.timestampMillis
        }
        val slot = intent.getIntExtra("android.telephony.extra.SLOT_INDEX", intent.getIntExtra("slot", -1))

        for ((from, body) in bySender) {
            val frame = JSONObject()
                .put("type", "incoming")
                .put("from", from)
                .put("body", body.toString())
                .put("timestamp", timestamp)
            if (slot >= 0) frame.put("simSlot", slot)
            Stats.inc(ctx, Stats.RECEIVED)
            AppLog.add(ctx.getString(R.string.log_incoming, from))
            Outbox.push(frame)
        }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (Prefs.startOnBoot(ctx) && Prefs.isEnabled(ctx) && Prefs.isPaired(ctx)) {
            runCatching { GatewayService.start(ctx) }
        }
    }
}
