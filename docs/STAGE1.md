# Етап 1: структура, схема БД, розгортання

Чернетка на підтвердження. Виходить із реального сервера 193.242.161.21:
Debian 13, 2 vCPU, **2 GB RAM**, 30 GB диск, docker, на порту 80 вже живе
`paper-aquarium`. Домен `tv.sun-hunter.men`.

## Відхилення від стеку з CLAUDE.md (з причинами)

| Було в плані | Пропоную | Чому |
|---|---|---|
| Keycloak / Supabase Auth | **Better Auth** (TS-бібліотека в процесі API) | Keycloak потребує ~1 GB, на цьому сервері не поміститься поруч з рештою. Better Auth дає email+пароль, Google, magic-link, сесії в Postgres, без окремого сервісу. Власну крипту не пишемо. |
| EMQX | **Mosquitto + mosquitto-go-auth** зараз, EMQX коли пристроїв стане сотні | EMQX ~400 MB idle. Mosquitto ~5 MB, auth/ACL через HTTP до нашого API, TLS, LWT. Rate-limit на пристрій робимо в інжесті API. |
| Next.js | **Vite + React SPA**, статика через Caddy | SSR не потрібен для кабінету за логіном; Vite+React уже твій стек (sun-hunter.men, aquarium). Менше RAM. |
| nginx | **Caddy** | Автоматичний Let's Encrypt, range-запити й кеш-заголовки з коробки, один файл конфігу. |

Решта без змін: Node + TypeScript + Fastify, Postgres + TimescaleDB, Redis,
Preact для ТБ-сторінки, ffmpeg-воркер, docker-compose.

## Структура монорепо (pnpm workspaces)

```
deye-dashboard/
├── apps/
│   ├── api/            Fastify: REST, WebSocket, Better Auth, MQTT-інжест, ACL для брокера
│   │   ├── src/
│   │   │   ├── auth/       Better Auth, ролі, перевірка організації
│   │   │   ├── devices/    claim by code, unclaim, cfg для пристрою
│   │   │   ├── ingest/     MQTT-підписник -> парсинг -> Timescale + Redis
│   │   │   ├── screens/    CRUD екранів, публічний стан за токеном
│   │   │   ├── backgrounds/ бібліотека, завантаження, черга транскодування
│   │   │   ├── ws/         live-стан на екран
│   │   │   └── db/         drizzle-схема, міграції
│   │   └── test/
│   ├── worker/         ffmpeg-транскодування (окремий контейнер, окремий ліміт RAM)
│   ├── web/            кабінет: Vite + React + TS
│   └── tv/             екран для ТБ: Vite + Preact, окремий бандл < 50 KB
├── packages/
│   ├── shared/         zod-схеми API, типи конфігу екрана, спільні для api/web/tv
│   └── register-maps/  карти регістрів Deye (JSON) + парсер + тести на spike/dumps
├── firmware/           (є) PlatformIO, ESP8266/ESP32
├── spike/              (є) python-скрипти і дампи
├── deploy/
│   ├── docker-compose.yml   prod: caddy, postgres, redis, mosquitto, api, worker
│   ├── Caddyfile
│   └── mosquitto/           mosquitto.conf, go-auth
├── docs/
├── CLAUDE.md
├── package.json / pnpm-workspace.yaml
└── docker-compose.dev.yml   для локальної розробки (без caddy)
```

## Схема БД (Postgres 16 + TimescaleDB)

Таблиці Better Auth (`user`, `session`, `account`, `verification`) створює
бібліотека. Наші:

```sql
create type org_role as enum ('owner', 'admin', 'staff');   -- admin = адмін організації
-- адмін платформи: user.is_superadmin boolean

create table plans (
  id          text primary key,            -- 'free', 'pro'
  name        text not null,
  limits      jsonb not null               -- {"screens":1,"custom_backgrounds":false,
                                           --  "history_days":0,"radio":false,"branding":true}
);

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan_id     text not null references plans(id) default 'free',
  created_at  timestamptz not null default now()
);

create table memberships (
  org_id      uuid references organizations(id) on delete cascade,
  user_id     text references "user"(id) on delete cascade,
  role        org_role not null default 'staff',
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  token_hash  text not null unique,         -- у листі/посиланні сирий токен, у БД хеш
  role        org_role not null default 'staff',
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  text not null references "user"(id)
);

create table inverter_models (
  id          text primary key,            -- 'deye-hp3', 'deye-sg04lp3', 'deye-string'
  name        text not null,
  device_type int  not null,               -- reg 0: 2 string, 3 1ph hybrid, 5/6 3ph hybrid
  poll_ranges jsonb not null,              -- [[0,22],[500,700]]
  register_map jsonb not null              -- [{"reg":587,"key":"bat_v","scale":0.1,...}]
);

create table devices (
  id              text primary key,        -- device_id з MAC чипа, '3494546462e6'
  secret_hash     text not null,           -- argon2 від MQTT-пароля
  claim_code_hash text not null,           -- 8 символів на корпусі / у порталі
  org_id          uuid references organizations(id) on delete set null,
  name            text,
  hw              text, fw text,
  stick_serial    bigint,
  inverter_serial text,
  inverter_type   int,
  model_id        text references inverter_models(id),
  claimed_at      timestamptz,
  last_seen_at    timestamptz,
  online          boolean not null default false,   -- з LWT
  created_at      timestamptz not null default now()
);
create index on devices(org_id);

-- сирі регістри як прийшли: дозволяє перепарсити, коли уточнимо карту
create table telemetry_raw (
  time        timestamptz not null,
  device_id   text not null references devices(id) on delete cascade,
  start_reg   int  not null,
  regs        bytea not null
);
select create_hypertable('telemetry_raw', 'time');
-- retention: 7 днів для всіх (для налагодження), далі тільки parsed

-- розпарсені метрики, narrow-формат, стискається Timescale
create table telemetry (
  time        timestamptz not null,
  device_id   text not null references devices(id) on delete cascade,
  metric      text not null,               -- 'pv_w','load_w','grid_w','bat_soc',...
  value       double precision not null
);
select create_hypertable('telemetry', 'time');
create index on telemetry(device_id, metric, time desc);
-- retention за тарифом: джоба раз на добу видаляє рядки старіші за plans.limits.history_days

create table device_state (                -- останній стан, дублюється в Redis
  device_id   text primary key references devices(id) on delete cascade,
  updated_at  timestamptz not null,
  state       jsonb not null               -- {"pv_w":710,"bat_soc":100,...,"stale":false}
);

create table backgrounds (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,   -- null = стандартний
  name        text not null,
  category    text,
  license     text, source text,
  status      text not null default 'ready',   -- uploaded|processing|ready|failed
  files       jsonb,                           -- {"1080":"bg/xxx-1080.mp4","720":"..."}
  preview     text,
  created_at  timestamptz not null default now()
);

create table transcode_jobs (
  id            uuid primary key default gen_random_uuid(),
  background_id uuid not null references backgrounds(id) on delete cascade,
  status        text not null default 'queued',  -- queued|running|done|failed
  error         text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table screens (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  config      jsonb not null,              -- {"background":id,"widgets":[...],"radio":url,"theme":..}
  view_token  text not null unique,        -- 32 байти base64url, перевипускається
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

Права доступу зводяться до одного запиту: `memberships where org_id = X and
user_id = me`. Публічна сторінка ТБ читає `screens by view_token` і
`device_state` для пристроїв цієї організації, і нічого більше.

## Розкладка на сервері

```
Caddy :80 :443
  tv.sun-hunter.men
    /            -> apps/web (статика)
    /s/<token>   -> apps/tv (статика)
    /api/*       -> api:3000
    /ws          -> api:3000 (websocket)
    /media/*     -> файли фонів з диска, range + cache-control
  aqua.sun-hunter.men -> aqua:8000        (акваріум переїжджає за проксі, див. питання)

Mosquitto :8883 (TLS, серт із Caddy) <- пристрої
  auth/acl -> http://api:3000/internal/mqtt/*
Postgres+Timescale, Redis, api, worker: тільки внутрішня docker-мережа
```

Орієнтовний бюджет RAM: caddy 30, postgres 200, redis 15, mosquitto 10,
api 150, worker 100 (пік при ffmpeg 300+), акваріум як зараз. Разом близько
0.6 GB плюс акваріум, поміщається. Swap на сервері треба увімкнути.

## Що робимо в етапі 1

1. Каркас монорепо, pnpm, TypeScript, eslint, vitest.
2. `docker-compose.dev.yml`: postgres+timescale, redis, mosquitto.
3. Drizzle-схема вище, перша міграція, seed: тарифи free/pro, модель `deye-hp3`
   з картою з `spike/decode_hp3.py`.
4. `packages/register-maps`: парсер + тести на `spike/dumps`.
5. `deploy/`: compose + Caddyfile для сервера, без запуску.
