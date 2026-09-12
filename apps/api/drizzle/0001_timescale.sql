-- Custom migration: TimescaleDB hypertables, стиснення, retention.
CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable('telemetry_raw', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT create_hypertable('telemetry',     'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);

-- сирі регістри тримаємо 7 днів для перепарсингу і налагодження
SELECT add_retention_policy('telemetry_raw', INTERVAL '7 days', if_not_exists => TRUE);

-- стиснення розпарсених метрик старших за 3 дні
ALTER TABLE telemetry SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'device_id, metric',
  timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('telemetry', INTERVAL '3 days', if_not_exists => TRUE);

-- retention за тарифом робить джоба в API (plans.limits.history_days), не політика Timescale
