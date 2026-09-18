# Продакшн: 193.242.161.21

Код: `~/deye-dashboard` (git clone, `git pull` для оновлення). Секрети: `deploy/.env` (не в git).

Оновлення: `git pull`, далі скрипт (відвʼязано від SSH, бо збірка вантажить сервер і сесія може обірватись;
`flock` усередині не дає запустити два деплої одночасно):

```bash
cd ~/deye-dashboard && git pull
nohup deploy/deploy.sh api static > /tmp/deploy.log 2>&1 &    # цілі: api worker static migrate seed
tail -f /tmp/deploy.log                                        # у кінці DEPLOY-DONE або DEPLOY-FAILED
```

Вручну:

```bash
cd ~/deye-dashboard/deploy
docker compose up -d                      # усе
docker compose build api && docker compose up -d api
docker compose run --rm api node --experimental-strip-types src/db/migrate.ts
docker compose logs -f caddy api
```

## Хости

| Хост | Куди |
|---|---|
| https://tv.sun-hunter.men | Caddy: `/api/*`, `/ws` -> api; `/s/*` -> tv; `/media/*` -> файли; решта -> web |
| https://aqua.sun-hunter.men | акваріум `/opt/paper-aquarium`, контейнер `aqua:8000` |

Акваріум знятий з порту 80 файлом `/opt/paper-aquarium/docker-compose.override.yml`
(`ports: !reset []`); Caddy ходить до нього через мережу `paper-aquarium_default`.
Не видаляти override, інакше акваріум знову захопить :80 і Caddy не стартує.

Сертифікати Caddy копіюються в volume `certs` контейнером `certsync` для Mosquitto (8883).
На :8090 живе сторонній python-процес, не наш.

## Caddyfile після `git pull`

`Caddyfile` примонтований як окремий файл, тому після зміни в git контейнер
бачить старий inode. `caddy reload` не допоможе — потрібно
`docker compose up -d --force-recreate caddy` (простій 2-3 с).

## Підключення ТБ

На ТБ відкрити `tv.sun-hunter.men/tv`, у кабінеті в редакторі екрана натиснути
«Код для ТБ» (6 цифр, 15 хв). Токен зберігається в localStorage браузера ТБ,
повторний захід на `/tv` відкриває екран без коду. Перевипуск посилання
скидає і збережений токен на ТБ (сторінка покаже введення коду знову).
