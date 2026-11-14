#!/bin/sh
# Версія трансляції для HLS (ТБ без WebRTC): звук Opus -> AAC (Opus ТБ не грають), відео перекодоване з ключовим
# кадром щосекунди — браузер ведучого шле його раз на ~2 с, а сегмент HLS не коротший за інтервал ключових кадрів.
# Сегменти по 1 с — затримка ~3–4 с замість ~6–8. Ціна — приблизно одне ядро на ефір 720p.
# Запускає MediaMTX (runOnOnline), поки оригінал онлайн; MTX_PATH і RTSP_PORT дає він, LIVE_INTERNAL_PASS — compose.
SRC="rtsp://mtx:${LIVE_INTERNAL_PASS}@127.0.0.1:${RTSP_PORT}/${MTX_PATH}"
exec ffmpeg -nostdin -hide_banner -loglevel warning \
  -rtsp_transport tcp -i "$SRC" \
  -map 0:v:0 -map '0:a:0?' \
  -c:v libx264 -preset veryfast -tune zerolatency -profile:v main -pix_fmt yuv420p \
  -force_key_frames 'expr:gte(t,n_forced*1)' -sc_threshold 0 \
  -b:v 2500k -maxrate 2500k -bufsize 2500k \
  -c:a aac -b:a 128k -ac 2 \
  -f rtsp -rtsp_transport tcp "$SRC/tv"
