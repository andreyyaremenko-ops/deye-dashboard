// Deye/Solarman -> MQTT bridge (spike). ESP8266 (Wemos D1 mini) та ESP32.
//
// 1. Перший старт: точка доступу "deye-XXXXXX" з captive-порталом (WiFiManager):
//    WiFi + MQTT + (опційно) IP/серійник стіка.
// 2. Пошук стіка: UDP broadcast WIFIKIT-214028-READ:48899 -> "IP,MAC,SERIAL".
// 3. Опитування V5/Modbus, сирі регістри -> MQTT devices/<id>/telemetry (JSON, hex).
// 4. Список діапазонів приходить retained-повідомленням у devices/<id>/cfg.

#include <Arduino.h>
#ifdef ESP8266
  #include <ESP8266WiFi.h>
#else
  #include <WiFi.h>
#endif
#include <WiFiUdp.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>

#include "solarman_v5.h"

#ifndef PORTAL_PIN
#define PORTAL_PIN 0
#endif

// ------------------------------------------------------------------ config

struct Config {
    char mqttHost[64] = "";
    char mqttPort[6]  = "1883";
    char mqttUser[32] = "";
    char mqttPass[64] = "";
    char stickIp[16]  = "";      // порожньо = автопошук
    char stickSerial[12] = "";   // порожньо = з автопошуку
    char pollSec[4]   = "10";
} cfg;

static const char* CFG_PATH = "/config.json";

bool loadConfig() {
    File f = LittleFS.open(CFG_PATH, "r");
    if (!f) return false;
    JsonDocument doc;
    if (deserializeJson(doc, f)) { f.close(); return false; }
    f.close();
    strlcpy(cfg.mqttHost, doc["mqtt_host"] | "", sizeof cfg.mqttHost);
    strlcpy(cfg.mqttPort, doc["mqtt_port"] | "1883", sizeof cfg.mqttPort);
    strlcpy(cfg.mqttUser, doc["mqtt_user"] | "", sizeof cfg.mqttUser);
    strlcpy(cfg.mqttPass, doc["mqtt_pass"] | "", sizeof cfg.mqttPass);
    strlcpy(cfg.stickIp, doc["stick_ip"] | "", sizeof cfg.stickIp);
    strlcpy(cfg.stickSerial, doc["stick_serial"] | "", sizeof cfg.stickSerial);
    strlcpy(cfg.pollSec, doc["poll_sec"] | "10", sizeof cfg.pollSec);
    return true;
}

void saveConfig() {
    JsonDocument doc;
    doc["mqtt_host"] = cfg.mqttHost;  doc["mqtt_port"] = cfg.mqttPort;
    doc["mqtt_user"] = cfg.mqttUser;  doc["mqtt_pass"] = cfg.mqttPass;
    doc["stick_ip"] = cfg.stickIp;    doc["stick_serial"] = cfg.stickSerial;
    doc["poll_sec"] = cfg.pollSec;
    File f = LittleFS.open(CFG_PATH, "w");
    if (f) { serializeJson(doc, f); f.close(); }
}

// ------------------------------------------------------------------- state

String deviceId;                  // з MAC: "a1b2c3d4e5f6"
String topicBase;                 // "devices/<id>/"
WiFiClient mqttNet;
PubSubClient mqtt(mqttNet);

struct Stick {
    IPAddress ip;
    uint32_t  serial = 0;
    bool      known = false;
    uint8_t   failures = 0;
    uint32_t  lastDiscovery = 0;
} stick;

// Діапазони опитування. За замовчуванням: ідентифікація + трифазний гібрид.
// Сервер може замінити через devices/<id>/cfg: {"ranges":[[0,22],[500,700]],"interval":10}
struct Range { uint16_t start, end; };
Range ranges[8] = {{0, 22}, {500, 700}};
uint8_t rangeCount = 2;
uint16_t pollIntervalMs = 10000;
const uint16_t CHUNK = 60;

uint8_t v5seq = 1;
uint32_t pollSeq = 0;
uint32_t lastPoll = 0;
bool pollNow = false;

// --------------------------------------------------------------- discovery

bool readExact(WiFiClient& c, uint8_t* buf, size_t n, uint32_t timeoutMs);

// Пробний V5-кадр із серійником 0: стік відповідає кадром зі своїм серійником
// у заголовку. Повертає серійник або 0. Працює і зі стіками, що мовчать на WIFIKIT.
uint32_t probeStick(IPAddress ip, uint16_t connectMs) {
    WiFiClient c;
    c.setTimeout(connectMs);
    if (!c.connect(ip, 8899)) return 0;
    uint8_t frame[v5::MAX_FRAME];
    size_t n = v5::buildReadHolding(frame, sizeof frame, 0, 0x01, 1, 0, 1);
    c.write(frame, n);
    uint32_t serial = 0;
    for (int i = 0; i < 3 && readExact(c, frame, v5::HEADER_LEN, 2000); i++) {
        size_t total = v5::frameLength(frame);
        if (!total || total > sizeof frame) break;
        readExact(c, frame + v5::HEADER_LEN, total - v5::HEADER_LEN, 1000);
        if (v5::isResponse(frame)) { serial = v5::headerSerial(frame); break; }
    }
    c.stop();
    return serial;
}

bool acceptStick(IPAddress ip, uint32_t serial, const char* how) {
    if (!serial) return false;
    if (stick.serial && serial != stick.serial) {
        Serial.printf("[disc] %s: serial %lu != expected %lu, skip\n", how, (unsigned long)serial, (unsigned long)stick.serial);
        return false;
    }
    stick.ip = ip; stick.serial = serial; stick.known = true; stick.failures = 0;
    stick.lastDiscovery = millis();
    Serial.printf("[disc] stick %s serial %lu (%s)\n", ip.toString().c_str(), (unsigned long)serial, how);
    // кешуємо IP для наступного старту
    String ipStr = ip.toString();
    if (ipStr != cfg.stickIp) { strlcpy(cfg.stickIp, ipStr.c_str(), sizeof cfg.stickIp); saveConfig(); }
    return true;
}

bool discoverBroadcast(uint32_t timeoutMs = 3000) {
    WiFiUDP udp;
    udp.begin(48899);
    IPAddress bcast = (uint32_t)WiFi.localIP() | ~(uint32_t)WiFi.subnetMask();
    Serial.printf("[disc] broadcast to %s:48899\n", bcast.toString().c_str());
    bool found = false;
    for (int attempt = 0; attempt < 2 && !found; attempt++) {
        udp.beginPacket(bcast, 48899);
        udp.write((const uint8_t*)"WIFIKIT-214028-READ", 19);
        udp.endPacket();
        uint32_t t0 = millis();
        while (millis() - t0 < timeoutMs && !found) {
            int n = udp.parsePacket();
            if (n > 0) {
                char buf[128];
                int len = udp.read(buf, sizeof buf - 1);
                buf[len > 0 ? len : 0] = 0;
                Serial.printf("[disc] %s -> %s\n", udp.remoteIP().toString().c_str(), buf);
                char* ipStr = strtok(buf, ",");
                char* mac = strtok(nullptr, ",");
                char* sn = strtok(nullptr, ",\r\n");
                if (ipStr && mac && sn) {
                    IPAddress ip; ip.fromString(ipStr);
                    found = acceptStick(ip, strtoul(sn, nullptr, 10), "broadcast");
                }
            }
            delay(10);
        }
    }
    udp.stop();
    return found;
}

// Резерв: перебір /24 по TCP 8899 + probe. При слабкому сигналі 250 мс замало,
// 700 мс дає ~3 хв у гіршому випадку — прийнятно для резервного шляху.
uint16_t scanProbeMs = 700;
bool discoverScan() {
    IPAddress me = WiFi.localIP();
    Serial.printf("[disc] scanning %u.%u.%u.0/24 for tcp 8899\n", me[0], me[1], me[2]);
    for (int host = 1; host < 255; host++) {
        IPAddress ip(me[0], me[1], me[2], host);
        if (ip == me) continue;
        if (mqtt.connected()) mqtt.loop();
        uint32_t serial = probeStick(ip, scanProbeMs);
        if (serial && acceptStick(ip, serial, "scan")) return true;
        yield();
    }
    return false;
}

// Порядок: кешований IP -> broadcast -> скан підмережі.
bool findStick() {
    stick.lastDiscovery = millis();
    if (cfg.stickIp[0]) {
        IPAddress ip; ip.fromString(cfg.stickIp);
        // Дві спроби: стік тримає одного TCP-клієнта і після нашого ресету
        // ще кілька секунд може вважати старе зʼєднання живим.
        for (int i = 0; i < 2; i++) {
            if (acceptStick(ip, probeStick(ip, 1500), "cached ip")) return true;
            Serial.printf("[disc] cached %s: no answer\n", cfg.stickIp);
            delay(2000);
        }
    }
    if (discoverBroadcast()) return true;
    return discoverScan();
}

// -------------------------------------------------------------------- V5 IO

bool readExact(WiFiClient& c, uint8_t* buf, size_t n, uint32_t timeoutMs) {
    size_t got = 0;
    uint32_t t0 = millis();
    while (got < n) {
        if (!c.connected() && !c.available()) return false;
        int avail = c.available();
        if (avail > 0) {
            int r = c.read(buf + got, min((size_t)avail, n - got));
            if (r > 0) got += r;
        } else {
            if (millis() - t0 > timeoutMs) return false;
            delay(5);
        }
    }
    return true;
}

// Один запит 0x03. Повертає статус; regs заповнюється при Ok.
v5::Status readHolding(WiFiClient& c, uint16_t start, uint16_t count, uint16_t* regs) {
    static uint8_t frame[v5::MAX_FRAME];
    v5seq = (v5seq + 1) & 0xFF; if (!v5seq) v5seq = 1;
    size_t n = v5::buildReadHolding(frame, sizeof frame, stick.serial, v5seq, 1, start, count);
    if (!n) return v5::Status::BadFrame;
    c.write(frame, n);

    // Пропускаємо до 5 чужих кадрів (heartbeat 0x4710 тощо)
    for (int i = 0; i < 5; i++) {
        if (!readExact(c, frame, v5::HEADER_LEN, 5000)) return v5::Status::BadFrame;
        size_t total = v5::frameLength(frame);
        if (!total || total > sizeof frame) return v5::Status::BadFrame;
        if (!readExact(c, frame + v5::HEADER_LEN, total - v5::HEADER_LEN, 2000)) return v5::Status::BadFrame;
        v5::Result r = v5::parseResponse(frame, total, v5seq, count, regs);
        if (r.status == v5::Status::NotResponse || r.status == v5::Status::SeqMismatch) {
            Serial.printf("[v5] skip frame ctrl=0x%04x\n", r.control);
            continue;
        }
        if (r.status == v5::Status::ModbusException)
            Serial.printf("[v5] modbus exception %d at %u\n", r.modbusException, start);
        return r.status;
    }
    return v5::Status::BadFrame;
}

// ------------------------------------------------------------------ polling

static const char* HEXCHARS = "0123456789abcdef";

void appendHex(String& s, const uint16_t* regs, uint16_t n) {
    for (uint16_t i = 0; i < n; i++) {
        s += HEXCHARS[(regs[i] >> 12) & 0xF]; s += HEXCHARS[(regs[i] >> 8) & 0xF];
        s += HEXCHARS[(regs[i] >> 4) & 0xF];  s += HEXCHARS[regs[i] & 0xF];
    }
}

void publishInfo() {
    JsonDocument doc;
    doc["fw"] = FW_VERSION;
#ifdef ESP8266
    doc["hw"] = "esp8266";
#else
    doc["hw"] = "esp32";
#endif
    doc["ip"] = WiFi.localIP().toString();
    doc["rssi"] = WiFi.RSSI();
    doc["stick_ip"] = stick.known ? stick.ip.toString() : "";
    doc["stick_serial"] = stick.serial;
    doc["uptime"] = millis() / 1000;
    doc["heap"] = ESP.getFreeHeap();
    String out; serializeJson(doc, out);
    mqtt.publish((topicBase + "info").c_str(), out.c_str(), true);
}

bool pollCycle() {
    if (!stick.known) return false;
    WiFiClient c;
    c.setTimeout(5000);
    if (!c.connect(stick.ip, 8899)) {
        Serial.printf("[poll] connect %s:8899 failed\n", stick.ip.toString().c_str());
        return false;
    }
    static uint16_t regs[CHUNK];
    String payload;
    payload.reserve(1024);
    time_t now = time(nullptr);
    payload += "{\"seq\":" + String(++pollSeq);
    payload += ",\"ts\":" + String(now > 1700000000 ? (uint32_t)now : 0);
    payload += ",\"uptime\":" + String(millis() / 1000);
    payload += ",\"stick\":" + String(stick.serial);
    payload += ",\"ranges\":[";
    bool anyOk = false, first = true;

    for (uint8_t ri = 0; ri < rangeCount; ri++) {
        uint16_t start = ranges[ri].start;
        while (start < ranges[ri].end) {
            uint16_t count = min<uint16_t>(CHUNK, ranges[ri].end - start);
            v5::Status st = readHolding(c, start, count, regs);
            if (st == v5::Status::Ok) {
                if (!first) payload += ',';
                first = false;
                payload += "{\"start\":" + String(start) + ",\"regs\":\"";
                appendHex(payload, regs, count);
                payload += "\"}";
                anyOk = true;
            } else if (st == v5::Status::ModbusException) {
                break;  // цей діапазон інвертор не підтримує — далі
            } else {
                Serial.printf("[poll] regs %u+%u: status %d\n", start, count, (int)st);
                c.stop();
                goto done;
            }
            start += count;
            delay(50);
        }
    }
    c.stop();
done:
    payload += "]}";
    if (anyOk) {
        bool ok = mqtt.publish((topicBase + "telemetry").c_str(), payload.c_str());
        Serial.printf("[poll] #%lu %u bytes -> mqtt %s\n", (unsigned long)pollSeq, payload.length(), ok ? "ok" : "FAIL");
    }
    return anyOk;
}

// --------------------------------------------------------------------- MQTT

void onMqtt(char* topic, byte* data, unsigned int len) {
    String t(topic);
    if (!t.endsWith("/cfg") && !t.endsWith("/cmd")) return;
    JsonDocument doc;
    if (deserializeJson(doc, data, len)) { Serial.printf("[mqtt] bad json on %s (%u bytes)\n", topic, len); return; }

    if (t.endsWith("/cfg")) {
        JsonArray arr = doc["ranges"].as<JsonArray>();
        if (!arr.isNull() && arr.size() > 0 && arr.size() <= 8) {
            rangeCount = 0;
            for (JsonArray r : arr) {
                if (r.size() == 2) ranges[rangeCount++] = {r[0].as<uint16_t>(), r[1].as<uint16_t>()};
            }
        }
        if (doc["interval"].is<int>()) pollIntervalMs = constrain(doc["interval"].as<int>(), 2, 600) * 1000;
        Serial.printf("[cfg] %u ranges, interval %u ms\n", rangeCount, pollIntervalMs);
    } else if (t.endsWith("/cmd")) {
        const char* cmd = doc["cmd"] | "";
        if (!strcmp(cmd, "poll")) pollNow = true;
        else if (!strcmp(cmd, "rediscover")) {   // {"cmd":"rediscover","nocache":true,"scan_ms":700}
            stick.known = false; stick.lastDiscovery = 0;
            if (doc["nocache"] | false) cfg.stickIp[0] = 0;
            if (doc["scan_ms"].is<int>()) scanProbeMs = constrain(doc["scan_ms"].as<int>(), 100, 3000);
        }
        else if (!strcmp(cmd, "stick")) {   // {"cmd":"stick","ip":"192.168.1.126","serial":2763543833}
            IPAddress ip;
            if (ip.fromString(doc["ip"] | "")) {
                stick.serial = 0;
                if (!acceptStick(ip, doc["serial"] | probeStick(ip, 1500), "cmd")) Serial.println("[cmd] stick not accepted");
            }
        }
        else if (!strcmp(cmd, "reboot")) { delay(100); ESP.restart(); }
        else if (!strcmp(cmd, "portal")) { LittleFS.remove(CFG_PATH); delay(100); ESP.restart(); }
    }
}

bool mqttConnect() {
    if (!cfg.mqttHost[0]) return false;
    mqtt.setServer(cfg.mqttHost, atoi(cfg.mqttPort));
    mqtt.setCallback(onMqtt);
    mqtt.setBufferSize(MQTT_MAX_PACKET_SIZE);
    String statusTopic = topicBase + "status";
    bool ok = mqtt.connect(deviceId.c_str(),
                           cfg.mqttUser[0] ? cfg.mqttUser : nullptr,
                           cfg.mqttPass[0] ? cfg.mqttPass : nullptr,
                           statusTopic.c_str(), 1, true, "offline");
    if (ok) {
        mqtt.publish(statusTopic.c_str(), "online", true);
        mqtt.subscribe((topicBase + "cfg").c_str());
        mqtt.subscribe((topicBase + "cmd").c_str());
        publishInfo();
        Serial.printf("[mqtt] connected as %s\n", deviceId.c_str());
    } else {
        Serial.printf("[mqtt] connect failed rc=%d\n", mqtt.state());
    }
    return ok;
}

// -------------------------------------------------------------------- setup

bool shouldSave = false;

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.printf("\n\nDeye bridge %s\n", FW_VERSION);

    String mac = WiFi.macAddress(); mac.replace(":", ""); mac.toLowerCase();
    deviceId = mac;
    topicBase = "devices/" + deviceId + "/";

    if (!LittleFS.begin()) {
#ifdef ESP8266
        LittleFS.format(); LittleFS.begin();
#endif
    }
    bool haveCfg = loadConfig();

    pinMode(PORTAL_PIN, INPUT_PULLUP);
    bool forcePortal = digitalRead(PORTAL_PIN) == LOW;

    WiFiManager wm;
    WiFiManagerParameter pHost("mqtt_host", "MQTT host", cfg.mqttHost, sizeof cfg.mqttHost - 1);
    WiFiManagerParameter pPort("mqtt_port", "MQTT port", cfg.mqttPort, sizeof cfg.mqttPort - 1);
    WiFiManagerParameter pUser("mqtt_user", "MQTT user", cfg.mqttUser, sizeof cfg.mqttUser - 1);
    WiFiManagerParameter pPass("mqtt_pass", "MQTT password", cfg.mqttPass, sizeof cfg.mqttPass - 1);
    WiFiManagerParameter pIp("stick_ip", "Stick IP (порожньо = автопошук)", cfg.stickIp, sizeof cfg.stickIp - 1);
    WiFiManagerParameter pSn("stick_serial", "Stick serial (порожньо = з пошуку)", cfg.stickSerial, sizeof cfg.stickSerial - 1);
    WiFiManagerParameter pPoll("poll_sec", "Poll interval, s", cfg.pollSec, sizeof cfg.pollSec - 1);
    for (auto* p : {&pHost, &pPort, &pUser, &pPass, &pIp, &pSn, &pPoll}) wm.addParameter(p);
    wm.setSaveConfigCallback([]() { shouldSave = true; });
    wm.setConfigPortalTimeout(300);
    wm.setConnectTimeout(30);

    String apName = "deye-" + deviceId.substring(6);
    WiFi.mode(WIFI_STA);
    bool connected = (forcePortal || !haveCfg)
        ? wm.startConfigPortal(apName.c_str())
        : wm.autoConnect(apName.c_str());
    if (!connected) { Serial.println("[wifi] no connection, reboot"); delay(1000); ESP.restart(); }

    if (shouldSave) {
        strlcpy(cfg.mqttHost, pHost.getValue(), sizeof cfg.mqttHost);
        strlcpy(cfg.mqttPort, pPort.getValue(), sizeof cfg.mqttPort);
        strlcpy(cfg.mqttUser, pUser.getValue(), sizeof cfg.mqttUser);
        strlcpy(cfg.mqttPass, pPass.getValue(), sizeof cfg.mqttPass);
        strlcpy(cfg.stickIp, pIp.getValue(), sizeof cfg.stickIp);
        strlcpy(cfg.stickSerial, pSn.getValue(), sizeof cfg.stickSerial);
        strlcpy(cfg.pollSec, pPoll.getValue(), sizeof cfg.pollSec);
        saveConfig();
        Serial.println("[cfg] saved");
    }
    Serial.printf("[wifi] %s ip=%s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());

    pollIntervalMs = constrain(atoi(cfg.pollSec), 2, 600) * 1000;
    if (cfg.stickSerial[0]) stick.serial = strtoul(cfg.stickSerial, nullptr, 10);

    configTime(0, 0, "pool.ntp.org", "time.google.com");
    mqttConnect();
}

// --------------------------------------------------------------------- loop

uint32_t lastMqttTry = 0;

void loop() {
    if (WiFi.status() != WL_CONNECTED) { delay(500); return; }

    if (!mqtt.connected() && millis() - lastMqttTry > 5000) {
        lastMqttTry = millis();
        mqttConnect();
    }
    mqtt.loop();

    // Повторний пошук: стік невідомий, 3 провали підряд, або раз на годину.
    bool hourly = stick.known && millis() - stick.lastDiscovery > 3600000UL;
    bool retryDue = millis() - stick.lastDiscovery > 30000 || stick.lastDiscovery == 0;
    if ((!stick.known && retryDue) || stick.failures >= 3 || hourly) {
        stick.failures = 0;
        if (hourly) {
            // тільки перевіряємо, що стік ще на тому ж IP; інакше повний пошук
            if (probeStick(stick.ip, 1500) == stick.serial) stick.lastDiscovery = millis();
            else { stick.known = false; findStick(); }
        } else if (!findStick()) {
            Serial.println("[disc] not found");
        }
        if (mqtt.connected()) publishInfo();
    }

    if (stick.known && (pollNow || millis() - lastPoll >= pollIntervalMs)) {
        pollNow = false;
        lastPoll = millis();
        if (pollCycle()) stick.failures = 0;
        else stick.failures++;
        if (mqtt.connected() && pollSeq % 30 == 0) publishInfo();
    }
}
