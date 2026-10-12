package men.sunhunter.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import android.window.OnBackInvokedDispatcher

/**
 * Повноекранний WebView з нашим екраном ТБ (/tv: пара за кодом, далі /s/<token> з localStorage).
 * Відео й віджети лишаються на сторінці, радіо грає нативно через [Bridge].
 */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val home = Uri.parse(BuildConfig.TV_URL)
    private lateinit var radio: RadioPlayer
    private var web: WebView? = null
    private var reloadDelay = FIRST_RELOAD_MS
    private val reload = Runnable { web?.reload() }
    private var lastBack = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        radio = RadioPlayer(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { onBack() }
        }
        mountWebView()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onStart() {
        super.onStart()
        web?.onResume()
        radio.resume()
    }

    override fun onStop() {
        radio.pause()
        web?.onPause()
        super.onStop()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        radio.release()
        web?.destroy()
        web = null
        super.onDestroy()
    }

    @Deprecated("до Android 13; далі — OnBackInvokedCallback з onCreate")
    @Suppress("DEPRECATION")
    @SuppressLint("GestureBackNavigation")
    override fun onBackPressed() = onBack()

    /** «Назад» з пульта легко натиснути випадково: виходимо лише з другого натискання. */
    private fun onBack() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastBack < 2_000) finish()
        else Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show()
        lastBack = now
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun mountWebView() {
        web?.let { old -> (old.parent as? android.view.ViewGroup)?.removeView(old); old.destroy() }
        val w = WebView(this)
        w.setBackgroundColor(Color.BLACK)
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true                 // токен екрана живе в localStorage
            mediaPlaybackRequiresUserGesture = false // відеофон і камери без натискання пульта
            userAgentString = "$userAgentString SunHunterTV/${BuildConfig.VERSION_NAME}"
        }
        w.addJavascriptInterface(Bridge(radio, main), "SunHunterTv")
        w.webChromeClient = object : WebChromeClient() {
            // інакше до першого кадру відео WebView малює сіру кнопку «плей»
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        }
        w.webViewClient = Client()
        setContentView(w)
        web = w
        w.loadUrl(home.toString())
    }

    private inner class Client : WebViewClient() {
        /** чужі адреси не відкриваємо: міст доступний будь-якій сторінці в цьому WebView */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            request.url.host != home.host

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            // нова сторінка сама скаже, що грати; стара не встигла б зупинити радіо
            radio.stop()
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (!failed) reloadDelay = FIRST_RELOAD_MS
            failed = false
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) retryLater()
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && response.statusCode >= 500) retryLater()
        }

        /** процес рендера впав (буває на слабких ТБ через памʼять): збираємо WebView заново, а не падаємо */
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (view == web) main.post { mountWebView() }
            return true
        }
    }

    private var failed = false

    /** немає мережі після ввімкнення ТБ чи сервер оновлюється: пробуємо знову з наростаючою паузою */
    private fun retryLater() {
        failed = true
        main.removeCallbacks(reload)
        main.postDelayed(reload, reloadDelay)
        reloadDelay = (reloadDelay * 2).coerceAtMost(MAX_RELOAD_MS)
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    private companion object {
        const val FIRST_RELOAD_MS = 5_000L
        const val MAX_RELOAD_MS = 60_000L
    }
}
