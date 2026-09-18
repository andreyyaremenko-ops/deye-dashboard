#!/bin/sh
# Синхронізує /out/<app> -> /srv/<app> (volumes Caddy) без проміжку, коли файлів немає.
set -e
for app in tv web; do
  src=/out/$app; dst=/srv/$app
  cp -r "$src/." "$dst/"
  # прибрати застаріле: файли, яких немає в новій збірці (старі хешовані assets тощо), потім порожні теки
  ( cd "$dst" && find . -type f | while read -r f; do [ -e "$src/$f" ] || rm -f "$f"; done )
  find "$dst" -mindepth 1 -type d -empty -delete
done
echo static deployed
ls /srv/tv /srv/web
