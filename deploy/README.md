# Продакшн: 193.242.161.21

Код: `~/deye-dashboard` (git clone, `git pull` для оновлення). Секрети: `deploy/.env` (не в git).

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
