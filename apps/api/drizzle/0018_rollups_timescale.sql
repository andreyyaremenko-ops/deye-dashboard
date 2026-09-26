-- Custom migration (Timescale): ролапи телеметрії для графіків.
-- Було: кожен графік агрегував сирі рядки (3.6 млн/добу) — 14 днів з кроком 1 год = 2.8 с.
-- Стало: готові бакети, сирі рядки читаються лише для хвоста, ще не матеріалізованого.
-- Тримаємо sum+count, а не avg: тоді середнє на грубішому кроці (15 хв з 5-хвилинних) точне,
-- а не «середнє середніх». mx потрібен добовим лічильникам (вони скидаються опівночі -> max за добу).
-- Файл із "timescale" в імені пропускають тести на PGlite (apps/api/test/helpers.ts).

CREATE MATERIALIZED VIEW telemetry_5m
  WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('5 minutes'::interval, time) AS bucket, device_id, metric,
       sum(value) AS s, count(*) AS c, max(value) AS mx, min(value) AS mn
FROM telemetry
GROUP BY 1, 2, 3
WITH NO DATA;

CREATE INDEX telemetry_5m_device_metric_bucket_idx ON telemetry_5m (device_id, metric, bucket DESC);

CREATE MATERIALIZED VIEW telemetry_1h
  WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour'::interval, time) AS bucket, device_id, metric,
       sum(value) AS s, count(*) AS c, max(value) AS mx, min(value) AS mn
FROM telemetry
GROUP BY 1, 2, 3
WITH NO DATA;

CREATE INDEX telemetry_1h_device_metric_bucket_idx ON telemetry_1h (device_id, metric, bucket DESC);

-- start_offset менший за ретенцію: політика ніколи не перераховує старі бакети, тож ролапи
-- переживуть видалення сирих рядків. end_offset = два бакети — рекомендація Timescale.
SELECT add_continuous_aggregate_policy('telemetry_5m',
  start_offset => INTERVAL '1 day', end_offset => INTERVAL '10 minutes',
  schedule_interval => INTERVAL '10 minutes', if_not_exists => TRUE);

SELECT add_continuous_aggregate_policy('telemetry_1h',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '2 hours',
  schedule_interval => INTERVAL '30 minutes', if_not_exists => TRUE);
