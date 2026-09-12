import mqtt from "mqtt";
import { buildApp } from "./app.ts";
import { auth } from "./auth/index.ts";
import { config } from "./config.ts";
import { db, sql } from "./db/client.ts";
import { dispatch, type IngestDeps } from "./mqtt/ingest.ts";
import { RedisStateStore } from "./state/store.ts";

const store = new RedisStateStore(config.REDIS_URL);
const app = await buildApp({
  db, auth, store,
  publicUrl: config.PUBLIC_URL,
  mqttInternalUser: config.MQTT_INTERNAL_USER,
  mqttInternalPass: config.MQTT_INTERNAL_PASS,
  mediaRoot: config.MEDIA_ROOT,
  logger: { level: config.NODE_ENV === "production" ? "info" : "debug" },
});

// MQTT-інжест: API сам є підписником брокера
const client = mqtt.connect(config.MQTT_URL, {
  username: config.MQTT_INTERNAL_USER,
  password: config.MQTT_INTERNAL_PASS,
  clientId: `api-${process.pid}`,
  reconnectPeriod: 3000,
});
const ingest: IngestDeps = {
  db, store, log: app.log,
  publish: (topic, payload, retain) => new Promise((res, rej) =>
    client.publish(topic, payload, { qos: 1, retain: !!retain }, (e) => (e ? rej(e) : res()))),
};
client.on("connect", () => {
  app.log.info({ url: config.MQTT_URL }, "mqtt connected");
  client.subscribe(["devices/+/telemetry", "devices/+/status", "devices/+/info"], { qos: 1 });
});
client.on("error", (e) => app.log.warn({ err: e.message }, "mqtt error"));
client.on("message", (topic, payload) => { void dispatch(ingest, topic, payload); });

app.addHook("onClose", async () => { client.end(true); await store.close(); await sql.end(); });

try {
  await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
