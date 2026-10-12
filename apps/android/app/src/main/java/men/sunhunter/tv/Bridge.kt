package men.sunhunter.tv

import android.net.Uri
import android.os.Handler
import android.webkit.JavascriptInterface

/**
 * window.SunHunterTv на сторінці екрана. JS викликає методи з потоку WebView, плеєр живе в головному.
 * Контракт дзеркалить apps/tv/src/native.ts.
 */
class Bridge(private val radio: RadioPlayer, private val main: Handler) {
    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun radioPlay(url: String, volume: Double) {
        val scheme = Uri.parse(url).scheme
        if (scheme != "https" && scheme != "http") return
        main.post { radio.play(url, volume.toFloat().coerceIn(0f, 1f)) }
    }

    @JavascriptInterface
    fun radioVolume(volume: Double) {
        main.post { radio.setVolume(volume.toFloat().coerceIn(0f, 1f)) }
    }

    @JavascriptInterface
    fun radioStop() {
        main.post { radio.stop() }
    }
}
