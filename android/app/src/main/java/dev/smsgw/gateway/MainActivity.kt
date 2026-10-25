package dev.smsgw.gateway

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import com.google.android.material.textfield.TextInputEditText
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

class MainActivity : AppCompatActivity() {

    private lateinit var statusDot: View
    private lateinit var statusText: TextView
    private lateinit var statusSub: TextView
    private lateinit var toggleBtn: MaterialButton
    private lateinit var statSent: TextView
    private lateinit var statFailed: TextView
    private lateinit var statReceived: TextView
    private lateinit var warnCard: MaterialCardView
    private lateinit var permBtn: MaterialButton
    private lateinit var batteryBtn: MaterialButton
    private lateinit var pairCard: MaterialCardView
    private lateinit var pairInput: TextInputEditText
    private lateinit var logText: TextView

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
                toast(getString(R.string.need_sms_perm))
            }
            render()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        setSupportActionBar(findViewById<MaterialToolbar>(R.id.toolbar))

        statusDot = findViewById(R.id.statusDot)
        statusText = findViewById(R.id.statusText)
        statusSub = findViewById(R.id.statusSub)
        toggleBtn = findViewById(R.id.toggleBtn)
        statSent = findViewById(R.id.statSent)
        statFailed = findViewById(R.id.statFailed)
        statReceived = findViewById(R.id.statReceived)
        warnCard = findViewById(R.id.warnCard)
        permBtn = findViewById(R.id.permBtn)
        batteryBtn = findViewById(R.id.batteryBtn)
        pairCard = findViewById(R.id.pairCard)
        pairInput = findViewById(R.id.pairInput)
        logText = findViewById(R.id.logText)

        toggleBtn.setOnClickListener { toggle() }
        permBtn.setOnClickListener { requestNeededPermissions() }
        batteryBtn.setOnClickListener { askBatteryExemption() }
        findViewById<MaterialButton>(R.id.scanBtn).setOnClickListener { scanQr() }
        findViewById<MaterialButton>(R.id.pairBtn).setOnClickListener { applyPairing(pairInput.text?.toString().orEmpty()) }
        findViewById<MaterialButton>(R.id.clearLogBtn).setOnClickListener { AppLog.clear() }

        handleIntent(intent)
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == R.id.action_settings) {
            startActivity(Intent(this, SettingsActivity::class.java))
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        GatewayService.stateListener = { runOnUiThread { render() } }
        AppLog.listener = { runOnUiThread { renderLogAndStats() } }
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

    /** Opens Google's built-in QR scanner (no camera permission needed) and pairs with what it reads. */
    private fun scanQr() {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build()
        GmsBarcodeScanning.getClient(this, options)
            .startScan()
            .addOnSuccessListener { code ->
                val value = code.rawValue
                if (value.isNullOrBlank()) toast(getString(R.string.pair_invalid)) else applyPairing(value)
            }
            .addOnFailureListener { e ->
                AppLog.add(getString(R.string.log_scan_failed, e.message ?: ""))
                toast(getString(R.string.scan_failed))
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
        AppLog.add(getString(R.string.log_paired, hostOf(server)))
        toast(getString(R.string.pair_ok))

        requestNeededPermissions()
        // Restart so the service uses the new token.
        GatewayService.stop(this)
        GatewayService.start(this)
        render()
    }

    // ---------- start / stop ----------

    private fun toggle() {
        if (GatewayService.instance != null) {
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
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
    }

    private fun isBatteryExempt(): Boolean =
        (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)

    @SuppressLint("BatteryLife")
    private fun askBatteryExemption() {
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    // ---------- UI ----------

    private fun hostOf(server: String): String = Uri.parse(server).host ?: server

    private fun render() {
        val paired = Prefs.isPaired(this)
        pairCard.visibility = if (paired) View.GONE else View.VISIBLE

        val needPerms = neededPermissions().isNotEmpty()
        val needBattery = !isBatteryExempt()
        permBtn.visibility = if (needPerms) View.VISIBLE else View.GONE
        batteryBtn.visibility = if (needBattery) View.VISIBLE else View.GONE
        warnCard.visibility = if (needPerms || needBattery) View.VISIBLE else View.GONE

        val running = GatewayService.instance != null
        val s = when {
            !paired -> GatewayService.STATE_UNPAIRED
            GatewayService.state == GatewayService.STATE_UNAUTHORIZED && !running -> GatewayService.STATE_UNAUTHORIZED
            !running -> GatewayService.STATE_STOPPED
            else -> GatewayService.state
        }
        val (label, colorRes) = when (s) {
            GatewayService.STATE_CONNECTED -> R.string.state_connected to R.color.status_ok
            GatewayService.STATE_CONNECTING -> R.string.state_connecting to R.color.status_warn
            GatewayService.STATE_UNAUTHORIZED -> R.string.state_unauthorized to R.color.status_bad
            GatewayService.STATE_UNPAIRED -> R.string.not_paired to R.color.status_off
            else -> R.string.state_stopped to R.color.status_off
        }
        statusText.setText(label)
        statusDot.background.mutate().setTint(ContextCompat.getColor(this, colorRes))

        val sub = mutableListOf<String>()
        if (s == GatewayService.STATE_UNAUTHORIZED) {
            sub.add(getString(R.string.state_unauthorized_help))
        } else if (paired) {
            val name = Prefs.deviceName(this)
            sub.add(if (name.isNotBlank()) "$name · ${hostOf(Prefs.server(this))}" else hostOf(Prefs.server(this)))
            val q = GatewayService.queued.get()
            if (running && q > 0) sub.add(getString(R.string.queue_pending, q))
        }
        statusSub.text = sub.joinToString("\n")
        statusSub.visibility = if (sub.isEmpty()) View.GONE else View.VISIBLE

        toggleBtn.setText(if (running) R.string.stop else R.string.start)
        toggleBtn.isEnabled = paired
        renderLogAndStats()
    }

    private fun renderLogAndStats() {
        statSent.text = Stats.get(this, Stats.SENT).toString()
        statFailed.text = Stats.get(this, Stats.FAILED).toString()
        statReceived.text = Stats.get(this, Stats.RECEIVED).toString()
        logText.text = AppLog.text().ifEmpty { getString(R.string.log_empty) }
    }

    private fun toast(t: String) = Toast.makeText(this, t, Toast.LENGTH_LONG).show()
}
