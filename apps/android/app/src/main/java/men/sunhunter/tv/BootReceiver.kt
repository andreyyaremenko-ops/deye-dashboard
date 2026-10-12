package men.sunhunter.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Екран вмикається разом із ТБ. На Android 10+ спрацює, якщо видано SYSTEM_ALERT_WINDOW (див. README). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
