#!/bin/sh
# Деплой на проді. Запускати відвʼязано від SSH (збірка вантажить 2 vCPU, сесія може обірватись):
#   nohup deploy/deploy.sh api static > /tmp/deploy.log 2>&1 &   і далі  tail -f /tmp/deploy.log
# Цілі: api worker static migrate seed (у будь-якому складі). flock не дає запустити два деплої одночасно:
# контейнер static чистить /srv/web і /srv/tv перед копіюванням, і два паралельні запуски лишають сайт без файлів.
set -e
cd "$(dirname "$0")"
exec 9>/tmp/deye-deploy.lock
flock -n 9 || { echo "DEPLOY-FAILED: another deploy is running"; exit 1; }
trap 'echo DEPLOY-FAILED' EXIT

has() { for t in $TARGETS; do [ "$t" = "$1" ] && return 0; done; return 1; }
TARGETS="${*:-api static}"
echo "deploy: $TARGETS @ $(git log --oneline -1)"

BUILD=""; for t in api worker static; do has $t && BUILD="$BUILD $t"; done
[ -n "$BUILD" ] && docker compose build -q $BUILD
has migrate && docker compose run --rm -T api node --experimental-strip-types src/db/migrate.ts
has seed && docker compose run --rm -T api node --experimental-strip-types src/db/seed.ts
UP=""; for t in api worker; do has $t && UP="$UP $t"; done
[ -n "$UP" ] && docker compose up -d $UP
has static && docker compose run --rm -T static

trap - EXIT
echo DEPLOY-DONE
