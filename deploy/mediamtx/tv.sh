#!/bin/sh
# Версія трансляції для телевізорів: відео як є (браузер шле H.264), звук Opus -> AAC (Opus ТБ не грають).
# Запускає MediaMTX (runOnOnline), поки оригінал онлайн; MTX_PATH і RTSP_PORT дає він, LIVE_INTERNAL_PASS — compose.
SRC="rtsp://mtx:${LIVE_INTERNAL_PASS}@127.0.0.1:${RTSP_PORT}/${MTX_PATH}"
exec ffmpeg -nostdin -hide_banner -loglevel warning \
  -rtsp_transport tcp -i "$SRC" \
  -map 0:v:0 -map '0:a:0?' -c:v copy -c:a aac -b:a 128k -ac 2 \
  -f rtsp -rtsp_transport tcp "$SRC/tv"
