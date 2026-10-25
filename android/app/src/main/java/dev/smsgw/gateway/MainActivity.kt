package dev.smsgw.gateway

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var statusDot: View
    private lateinit var statusText: TextView
    private lateinit var serverText: TextView
    private lateinit var pairInput: EditText
    private lateinit var toggleBtn: Button
    private lateinit var permBtn: Button
    private lateinit var batteryBtn: Button
    private lateinit var logText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusDot = findViewById(R.id.statusDot)
        statusText = findViewById(R.id.statusText)
        serverText = findViewById(R.id.serverText)
        pairInput = findViewById(R.id.pairInput)
        toggleBtn = findViewById(R.id.toggleBtn)
        permBtn = findViewById(R.id.permBtn)
        batteryBtn = findViewById(R.id.batteryBtn)
        logText = findViewById(R.id.logText)

        findViewById<Button>(R.id.pairBtn).setOnClickListener { applyPairing(pairInput.text.toString()) }
        toggleBtn.setOnClickListener { toggle() }
        permBtn.setOnClickListener { requestNeededPermissions() }
        batteryBtn.setOnClickListener { askBatteryExemption() }

        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        GatewayService.stateListener = { s -> runOnUiThread { renderState(s) } }
        AppLog.listener = { runOnUiThread { logText.text = AppLog.text() } }
        render()
    }

    override fun onPause() {
        GatewayService.stateListener = null
        AppLog.listener = null
        super.onPause()
    }

    // ---------- pairing ----------

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val data = intent.data ?: return
        if (data.scheme == "smsgw") {
            applyPairing(data.toString())
            intent.data = null
        }
    }

    /** Accepts either https://server/pair#TOKEN (from the dashboard) or smsgw://pair?server=..&token=.. */
    private fun parsePairing(raw: String): Pair<String, String>? {
        val uri = Uri.parse(raw.trim())
        return when (uri.scheme?.lowercase()) {
            "smsgw" -> {
                val server = uri.getQueryParameter("server").orEmpty()
                val token = uri.getQueryParameter("token").orEmpty()
                if (server.startsWith("http") && token.isNotBlank()) server to token else null
            }
            "http", "https" -> {
                val token = uri.fragment.orEmpty()
                val path = uri.path.orEmpty().trimEnd('/')
                if (token.isBlank() || !path.endsWith("/pair")) return null
                val server = "${uri.scheme}://${uri.encodedAuthority}${path.removeSuffix("/pair")}"
                server to token
            }
            else -> null
        }
    }

    private fun applyPairing(raw: String) {
        val parsed = parsePairing(raw)
        if (parsed == null) {
            toast(getString(R.string.pair_invalid))
            return
        }
        val (server, token) = parsed
        Prefs.savePairing(this, server, token)
        pairInput.setText("")
        AppLog.add("تم حفظ الربط مع $server")
        toast(getString(R.string.pair_ok))

        requestNeededPermissions()
        // Restart so the service uses the new token.
        GatewayService.stop(this)
        GatewayService.start(this)
        render()
    }

    // ---------- start / stop ----------

    private fun toggle() {
        val running = GatewayService.instance != null
        if (running) {
            GatewayService.stop(this)
        } else {
            if (!Prefs.isPaired(this)) {
                toast(getString(R.string.need_pair))
                return
            }
            requestNeededPermissions()
            GatewayService.start(this)
        }
        render()
    }

    // ---------- permissions ----------

    private fun neededPermissions(): List<String> {
        val list = mutableListOf(
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_PHONE_STATE,
        )
        if (Build.VERSION.SDK_INT >= 33) list.add(Manifest.permission.POST_NOTIFICATIONS)
        return list.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
    }

    private fun requestNeededPermissions() {
        val missing = neededPermissions()
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            toast(getString(R.string.need_sms_perm))
        }
        render()
    }

    private fun isBatteryExempt(): Boolean =
        (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)

    @SuppressLint("BatteryLife")
    private fun askBatteryExemption() {
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
            )
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    // ---------- UI ----------

    private fun render() {
        serverText.text = if (Prefs.isPaired(this)) Prefs.server(this) else getString(R.string.not_paired)
        permBtn.visibility = if (neededPermissions().isEmpty()) View.GONE else View.VISIBLE
        batteryBtn.visibility = if (isBatteryExempt()) View.GONE else View.VISIBLE
        logText.text = AppLog.text().ifEmpty { getString(R.string.log_empty) }
        renderState(if (GatewayService.instance == null && GatewayService.state != GatewayService.STATE_UNAUTHORIZED)
            GatewayService.STATE_STOPPED else GatewayService.state)
    }

    private fun renderState(s: String) {
        val (label, color) = when (s) {
            GatewayService.STATE_CONNECTED -> getString(R.string.state_connected) to "#0F7A5A"
            GatewayService.STATE_CONNECTING -> getString(R.string.state_connecting) to "#C08A00"
            GatewayService.STATE_UNAUTHORIZED -> getString(R.string.state_unauthorized) to "#B3261E"
            GatewayService.STATE_UNPAIRED -> getString(R.string.not_paired) to "#888888"
            else -> getString(R.string.state_stopped) to "#888888"
        }
        statusText.text = label
        statusDot.background.mutate().setTint(Color.parseColor(color))
        val running = s == GatewayService.STATE_CONNECTED || s == GatewayService.STATE_CONNECTING
        toggleBtn.text = getString(if (running) R.string.stop else R.string.start)
    }

    private fun toast(t: String) = Toast.makeText(this, t, Toast.LENGTH_LONG).show()
}
