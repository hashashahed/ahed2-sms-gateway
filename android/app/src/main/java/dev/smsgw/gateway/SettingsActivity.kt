package dev.smsgw.gateway

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout

class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.setNavigationOnClickListener { finish() }
        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction()
                .replace(R.id.settingsContainer, SettingsFragment())
                .commit()
        }
    }
}

class SettingsFragment : PreferenceFragmentCompat() {

    override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
        // Same file the gateway reads its settings from.
        preferenceManager.sharedPreferencesName = Prefs.FILE
        setPreferencesFromResource(R.xml.settings, rootKey)
        val ctx = requireContext()
        val paired = Prefs.isPaired(ctx)

        findPreference<Preference>("server_info")?.summary =
            if (paired) Prefs.server(ctx) else getString(R.string.not_paired)

        findPreference<Preference>("open_dashboard")?.apply {
            isEnabled = paired
            setOnPreferenceClickListener {
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Prefs.server(ctx) + "/app"))) }
                true
            }
        }

        findPreference<Preference>("test_sms")?.setOnPreferenceClickListener {
            showTestDialog()
            true
        }

        findPreference<Preference>("unlink")?.apply {
            isEnabled = paired
            setOnPreferenceClickListener {
                confirmUnlink()
                true
            }
        }

        findPreference<Preference>("battery")?.setOnPreferenceClickListener {
            openBatterySettings()
            true
        }

        // The wake lock is held by the running service, so apply the change right away.
        findPreference<Preference>("keep_awake")?.setOnPreferenceChangeListener { _, _ ->
            Handler(Looper.getMainLooper()).post { GatewayService.instance?.refreshWakeLock() }
            true
        }

        findPreference<Preference>("version")?.summary = runCatching {
            ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName
        }.getOrNull() ?: "?"
    }

    private fun confirmUnlink() {
        val ctx = requireContext()
        MaterialAlertDialogBuilder(ctx)
            .setTitle(R.string.unlink_title)
            .setMessage(R.string.unlink_msg)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.pref_unlink) { _, _ ->
                GatewayService.stop(ctx)
                Prefs.clearPairing(ctx)
                AppLog.add(getString(R.string.log_unlinked))
                requireActivity().finish()
            }
            .show()
    }

    private fun showTestDialog() {
        val ctx = requireContext()
        val pad = (20 * resources.displayMetrics.density).toInt()
        val input = TextInputEditText(ctx).apply {
            inputType = InputType.TYPE_CLASS_PHONE
            textDirection = android.view.View.TEXT_DIRECTION_LTR
        }
        val layout = TextInputLayout(ctx).apply {
            hint = getString(R.string.test_hint)
            addView(input)
        }
        val box = FrameLayout(ctx).apply {
            setPadding(pad, pad / 2, pad, 0)
            addView(layout)
        }
        MaterialAlertDialogBuilder(ctx)
            .setTitle(R.string.test_title)
            .setView(box)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.test_send) { _, _ ->
                val number = input.text?.toString()?.trim().orEmpty()
                if (number.length < 3) return@setPositiveButton
                val app = ctx.applicationContext
                val body = getString(R.string.test_body)
                // Runs on its own thread: it doesn't touch the gateway queue and the server ignores its status.
                Thread { SmsSender.send(app, "test-${System.currentTimeMillis()}", number, body, null) }.start()
                Toast.makeText(ctx, R.string.test_sent, Toast.LENGTH_LONG).show()
            }
            .show()
    }

    @SuppressLint("BatteryLife")
    private fun openBatterySettings() {
        val ctx = requireContext()
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}")))
        } catch (e: Exception) {
            runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }
    }
}
