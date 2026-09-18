# deye-dashboard

SaaS: пристрій на ESP читає інвертор Deye через Solarman-стік і шле сирі регістри
в MQTT; сервер парсить, зберігає в Timescale і рендерить екран для смарт-ТБ
(відеофон + віджети). Повна специфікація: `docs/SPEC.md`. План етапу 1 і
схема БД: `docs/STAGE1.md`. Відкритий протокол (стік напряму, MQTT-контракт, OTA,
карти): `docs/PROTOCOL.md`.

## Прийняті рішення по стеку (2026-09-12)

Сервер 2 vCPU / 2 GB RAM, тому:
- Auth: **Better Auth** у процесі API (не Keycloak).
- MQTT: **Mosquitto + mosquitto-go-auth** (HTTP auth/ACL до API); EMQX пізніше.
- Кабінет: **Vite + React SPA**; екран ТБ: **Vite + Preact**, окремий бандл.
- Проксі/TLS: **Caddy**. Медіа: диск сервера через Caddy file_server.
- API: Fastify 5, Drizzle ORM, postgres-js, zod 4. Node 24+, TS без збірки
  (`--experimental-strip-types`, тому в TS тільки erasable-синтаксис, імпорти з `.ts`).
- Прошивка: PlatformIO, env `d1_mini` (ESP8266, перевірено) і `esp32dev`.
- Основний шлях даних: стік у режимі TCP-Client → `apps/api/src/solarman/` (порт 10000);
  плата — запасний шлях.
- Зовнішні стрічки (`apps/api/src/feeds/`): погода — Open-Meteo без ключа; тривоги —
  офіційний api.ukrainealarm.com (`ALERTS_API_KEY`): підписка на вебхук
  `/api/webhooks/ukrainealarm/<sha256(ключ)>`, повна синхронізація раз на 30 хв; API
  віддає 401 на щільні серії запитів з одним ключем (навіть curl з сервера), тому запити
  рознесені в часі. З 2026 тривоги оголошують по районах з рівнем (Yellow дрони / Red
  ракети): події вебхука приходять з regionId району чи громади, область активна, поки
  активний хоч один її район. Мапа regionId→область: `GET /api/v3/regions`, кеш у Redis
  `feed:regions` на 7 днів, плюс довчання з вкладених тривог у `/api/v3/alerts`. Без
  ключа — дзеркало ubilling.net.ua (`ALERTS_URL`, `off` вимикає). Кеш у Redis `feed:*`,
  WS-повідомлення `feed`. Місячна статистика — `device_counters` (база лічильників на
  початок місяця); працює й для організацій без історії. Тарифи (2026-09-18): Free = увесь
  функціонал на 1 екран + 1 логер з брендингом, Pro = на 5/5 без брендингу, Max 50/50;
  ліміти в `plans.limits` (seed), перевірки в createScreen/claimDevice/historyWindow.

## Структура

```
apps/api        Fastify: REST, WS, auth, MQTT-інжест, ACL для брокера
apps/web        кабінет (етап 4)
apps/tv         екран для ТБ (етап 4)
apps/worker     ffmpeg (етап 5)
packages/shared zod-схеми payload/конфігів, спільні типи
packages/register-maps  карти регістрів Deye + парсер; тести на spike/dumps
firmware/       прошивка ESP
spike/          python-скрипти і реальні дампи (фікстури, не видаляти)
deploy/         prod compose, Caddyfile, mosquitto
docs/           SPEC.md, STAGE1.md
```

## Команди

```
pnpm install
pnpm test               # vitest у всіх пакетах (register-maps на дампах, api на PGlite)
pnpm typecheck
pnpm db:generate        # drizzle-kit generate після зміни src/db/schema.ts
pnpm db:migrate && pnpm db:seed
docker compose -f docker-compose.dev.yml up -d   # postgres+timescale, redis, mosquitto
pnpm --filter @deye/api dev:mock                 # API без Docker: PGlite + демо-організація (demo@example.com), далі pnpm --filter @deye/web dev
cd firmware && pio test -e native && pio run -e d1_mini -t upload
cd apps/tv && npx vite build --config vite.config.ts --base=/ --outDir /tmp/tvprev preview   # превʼю віджетів на мок-даних (?skin=orbit|gauge|sankey|strip|bars&scene=day|evening|outage&theme=, ?type=text)
```

## Правила

- Пристрій шле сирі регістри; вся інтерпретація в `packages/register-maps` і
  таблиці `inverter_models`. Нові карти підтверджувати реальним дампом у
  `spike/dumps` і тестом на баланс (мережа + інвертор = навантаження).
- Тести обовʼязкові для: парсер V5 (firmware/test), карти регістрів, claim
  пристроїв, права доступу, ACL брокера.
- Секрети тільки через env; `.env.example` тримати актуальним.
- Не вигадувати бібліотеки: перевіряти `npm view <pkg> version`.
- Спілкування з користувачем українською.
