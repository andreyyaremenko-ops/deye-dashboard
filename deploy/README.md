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

## Домен і специфіка сервера

Домен задається одним рядком `DOMAIN=...` у `deploy/.env`: Caddy бере на нього сертифікат, API отримує
`PUBLIC_URL=https://$DOMAIN`, `certsync` копіює той самий сертифікат для Mosquitto як `/certs/server.crt|key`.
`STICK_HOST` (необовʼязково) — адреса сервера в підказці для Solarman-стіка, якщо це не домен (напр. IP).

Усе, що стосується лише конкретного сервера, лежить поза git:

- `deploy/caddy-extra/*.caddy` — додаткові сайти за тим самим Caddy (підключаються через `import`);
- `deploy/docker-compose.override.yml` — додаткові мережі/порти (compose підхоплює його сам).

На бойовому сервері (193.242.161.21) так підключено акваріум `aqua.sun-hunter.men`: блок `reverse_proxy aqua:8000`
у `caddy-extra/aqua.caddy` і зовнішня мережа `paper-aquarium_default` для сервісу `caddy` в override-файлі.
Акваріум знятий з порту 80 файлом `/opt/paper-aquarium/docker-compose.override.yml` (`ports: !reset []`);
не видаляти його, інакше акваріум знову захопить :80 і Caddy не стартує.

| Хост | Куди |
|---|---|
| `https://$DOMAIN` | Caddy: `/api/*`, `/ws` -> api; `/s/*` -> tv; `/media/*` -> файли; решта -> web |

Сертифікати Caddy копіюються в volume `certs` контейнером `certsync` для Mosquitto (8883).

## Caddyfile після `git pull`

`Caddyfile` примонтований як окремий файл, тому після зміни в git контейнер
бачить старий inode. `caddy reload` не допоможе — потрібно
`docker compose up -d --force-recreate caddy` (простій 2-3 с).

## Підключення ТБ

На ТБ відкрити `tv.sun-hunter.men/tv`, у кабінеті в редакторі екрана натиснути
«Код для ТБ» (6 цифр, 15 хв). Токен зберігається в localStorage браузера ТБ,
повторний захід на `/tv` відкриває екран без коду. Перевипуск посилання
скидає і збережений токен на ТБ (сторінка покаже введення коду знову).
