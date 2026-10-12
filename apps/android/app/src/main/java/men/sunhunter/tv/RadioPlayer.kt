package men.sunhunter.tv

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * Радіо поза WebView. Звук декодується програмно і не займає апаратний декодер, тож відеофон
 * сторінки грає далі — саме цього не вміють ТБ з одним медіаелементом у браузері.
 * Усі виклики — з головного потоку.
 */
class RadioPlayer(context: Context) {
    private val main = Handler(Looper.getMainLooper())
    // фокус звуку не беремо: інакше Chromium/фон ТБ можуть забрати його й поставити радіо на паузу —
    // та сама проблема, від якої тікаємо
    private val player = ExoPlayer.Builder(context)
        .setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
            false,
        )
        .build()

    private var url: String? = null
    private var foreground = true
    private var delay = FIRST_RETRY_MS
    private val retry = Runnable { start() }

    init {
        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) = schedule()
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) delay = FIRST_RETRY_MS
                if (state == Player.STATE_ENDED) schedule()   // нескінченний стрім «закінчився» = обрив
            }
        })
    }

    fun play(next: String, volume: Float) {
        player.volume = volume
        if (next == url) return   // та сама станція: сторінка просто повторила команду
        url = next
        delay = FIRST_RETRY_MS
        start()
    }

    fun setVolume(volume: Float) { player.volume = volume }

    fun stop() {
        url = null
        main.removeCallbacks(retry)
        player.stop()
        player.clearMediaItems()
    }

    /** Застосунок пішов з екрана: ефір не тримаємо, після повернення — з поточного місця, а не зі старого буфера. */
    fun pause() {
        foreground = false
        main.removeCallbacks(retry)
        player.stop()
    }

    fun resume() {
        foreground = true
        start()
    }

    fun release() {
        main.removeCallbacks(retry)
        player.release()
    }

    private fun start() {
        main.removeCallbacks(retry)
        val u = url ?: return
        if (!foreground) return
        player.setMediaItem(MediaItem.fromUri(u))
        player.prepare()
        player.play()
    }

    /** обрив чи помилка: перезапуск із наростаючою паузою, як у браузерній версії */
    private fun schedule() {
        main.removeCallbacks(retry)
        if (url == null || !foreground) return
        main.postDelayed(retry, delay)
        delay = (delay * 2).coerceAtMost(MAX_RETRY_MS)
    }

    private companion object {
        const val FIRST_RETRY_MS = 2_000L
        const val MAX_RETRY_MS = 60_000L
    }
}
