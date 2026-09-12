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
  #include <ESP8266HTTPClient.h>
  #include <ESP8266httpUpdate.h>
  #include <ESP8266WebServer.h>
  #define WebServerT ESP8266WebServer
  #define httpUpdateT ESPhttpUpdate
#else
  #include <WiFi.h>
  #include <HTTPClient.h>
  #include <HTTPUpdate.h>
  #include <WebServer.h>
  #define WebServerT WebServer
  #define httpUpdateT httpUpdate
#endif
#include <WiFiUdp.h>
#include <WiFiClientSecure.h>
#include "certs.h"
#include "fw_pubkey.h"
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>

#include "solarman_v5.h"

#ifndef PORTAL_PIN
#define PORTAL_PIN 0
#endif
#ifndef API_HOST
#define API_HOST "tv.sun-hunter.men"
#endif
#ifdef ESP8266
#define HW_NAME "esp8266"
#else
#define HW_NAME "esp32"
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
    char mqttTls[2]   = "1";     // 0 = без TLS, 1 = TLS з перевіркою CA, 2 = TLS без перевірки
    char apiHost[64]  = API_HOST; // сервер платформи (HTTPS: реєстрація, OTA)
    char claimCode[10] = "";     // код привʼязки, показується в порталі і на сторінці статусу
    char registered[2] = "0";    // "1" після успішної самореєстрації
    char channel[8]   = "stable";
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
    strlcpy(cfg.mqttTls, doc["mqtt_tls"] | "1", sizeof cfg.mqttTls);
    strlcpy(cfg.apiHost, doc["api_host"] | API_HOST, sizeof cfg.apiHost);
    strlcpy(cfg.claimCode, doc["claim_code"] | "", sizeof cfg.claimCode);
    // старий конфіг без прапорця, але з обліковими даними — вважаємо зареєстрованим
    strlcpy(cfg.registered, doc["registered"] | (cfg.mqttUser[0] ? "1" : "0"), sizeof cfg.registered);
    strlcpy(cfg.channel, doc["channel"] | "stable", sizeof cfg.channel);
    return true;
}

void saveConfig() {
    JsonDocument doc;
    doc["mqtt_host"] = cfg.mqttHost;  doc["mqtt_port"] = cfg.mqttPort;
    doc["mqtt_user"] = cfg.mqttUser;  doc["mqtt_pass"] = cfg.mqttPass;
    doc["stick_ip"] = cfg.stickIp;    doc["stick_serial"] = cfg.stickSerial;
    doc["poll_sec"] = cfg.pollSec;   doc["mqtt_tls"] = cfg.mqttTls;
    doc["api_host"] = cfg.apiHost;   doc["claim_code"] = cfg.claimCode;
    doc["registered"] = cfg.registered; doc["channel"] = cfg.channel;
    File f = LittleFS.open(CFG_PATH, "w");
    if (f) { serializeJson(doc, f); f.close(); }
}

// ------------------------------------------------------------------- state

String deviceId;                  // з MAC: "a1b2c3d4e5f6"
String topicBase;                 // "devices/<id>/"
WiFiClient mqttNet;
#ifdef ESP8266
BearSSL::WiFiClientSecure mqttTlsNet;
BearSSL::X509List trustAnchors(ISRG_ROOT_X1);
BearSSL::PublicKey signPubKey(signing_pubkey);
BearSSL::HashSHA256 otaHash;
BearSSL::SigningVerifier otaSign(&signPubKey);
#else
WiFiClientSecure mqttTlsNet;
#endif
PubSubClient mqtt;
WebServerT web(80);
String lastError;                 // показується на сторінці статусу
uint32_t lastOtaCheck = 0;
bool otaRequested = false;

bool timeSynced() { return time(nullptr) > 1700000000; }

/** Чекаємо NTP: без правильного часу TLS з перевіркою сертифіката не пройде. */
bool waitForTime(uint32_t ms) {
    uint32_t t0 = millis();
    while (!timeSynced() && millis() - t0 < ms) delay(100);
    return timeSynced();
}

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


// ------------------------------------------------------------ provisioning

static const char CLAIM_ALPHABET[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Перший запуск: сам генеруємо секрет і код привʼязки. Мережі ще може не бути. */
void ensureCredentials() {
    if (cfg.mqttUser[0] && cfg.mqttPass[0]) return;
    strlcpy(cfg.mqttUser, deviceId.c_str(), sizeof cfg.mqttUser);
    for (int i = 0; i < 48; i++) {
        uint8_t v = (uint8_t)(RANDOM_REG32 >> (8 * (i % 4)));
        cfg.mqttPass[i] = "0123456789abcdef"[v & 0xF];
    }
    cfg.mqttPass[48] = 0;
    for (int i = 0; i < 8; i++) cfg.claimCode[i] = CLAIM_ALPHABET[(RANDOM_REG32 >> 3) % 32];
    cfg.claimCode[8] = 0;
    if (!cfg.mqttHost[0]) strlcpy(cfg.mqttHost, cfg.apiHost, sizeof cfg.mqttHost);
    if (!strcmp(cfg.mqttPort, "1883")) strlcpy(cfg.mqttPort, "8883", sizeof cfg.mqttPort);
    strlcpy(cfg.mqttTls, "1", sizeof cfg.mqttTls);
    strlcpy(cfg.registered, "0", sizeof cfg.registered);
    saveConfig();
    Serial.printf("[prov] generated credentials, claim code %s\n", cfg.claimCode);
}

/** HTTPS-запит до сервера платформи. Повний RX-буфер: Caddy не вміє MFLN. */
int httpsRequest(const char* method, const String& path, const String& body, String& out) {
    if (!waitForTime(15000)) { lastError = "no NTP time"; return -1; }
#ifdef ESP8266
    BearSSL::WiFiClientSecure c;
    c.setTrustAnchors(&trustAnchors);
#else
    WiFiClientSecure c;
    c.setCACert(ISRG_ROOT_X1);
#endif
    c.setTimeout(15000);
    HTTPClient http;
    http.setTimeout(15000);
    if (!http.begin(c, String("https://") + cfg.apiHost + path)) { lastError = "http begin failed"; return -1; }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("User-Agent", "deye-esp/" FW_VERSION);
    int code = !strcmp(method, "POST") ? http.POST(body) : http.GET();
    out = code > 0 ? http.getString() : http.errorToString(code);
    http.end();
    return code;
}

/** Самореєстрація на сервері: secret + claim code один раз. */
bool registerDevice() {
    JsonDocument doc;
    doc["id"] = deviceId; doc["secret"] = cfg.mqttPass; doc["claimCode"] = cfg.claimCode;
    doc["hw"] = HW_NAME; doc["fw"] = FW_VERSION;
    String body; serializeJson(doc, body);
    String resp;
    int code = httpsRequest("POST", "/api/devices/register", body, resp);
    Serial.printf("[prov] register -> %d %s\n", code, resp.c_str());
    if (code == 201) {
        strlcpy(cfg.registered, "1", sizeof cfg.registered); saveConfig(); lastError = ""; return true;
    }
    if (code == 409 && resp.indexOf("claim_code_taken") >= 0) {   // колізія коду — новий код, повтор
        for (int i = 0; i < 8; i++) cfg.claimCode[i] = CLAIM_ALPHABET[(RANDOM_REG32 >> 3) % 32];
        saveConfig();
        return false;
    }
    lastError = String("register ") + code + ": " + resp.substring(0, 120);
    return false;
}

// -------------------------------------------------------------------- OTA

/** Перевірка нової версії; оновлення лише підписаним образом (перевіряє Updater). */
void checkOta(bool force) {
    if (!force && millis() - lastOtaCheck < 6UL * 3600UL * 1000UL && lastOtaCheck) return;
    lastOtaCheck = millis();
    String resp;
    int code = httpsRequest("GET", String("/api/firmware/latest?hw=" HW_NAME "&channel=") + cfg.channel, "", resp);
    if (code == 404) { Serial.println("[ota] no firmware on server"); return; }
    if (code != 200) { Serial.printf("[ota] check failed %d\n", code); return; }
    JsonDocument doc;
    if (deserializeJson(doc, resp)) return;
    const char* version = doc["version"] | "";
    const char* url = doc["url"] | "";
    if (!strcmp(version, FW_VERSION) || !url[0]) { Serial.printf("[ota] up to date (%s)\n", FW_VERSION); return; }
    Serial.printf("[ota] %s -> %s, downloading\n", FW_VERSION, version);
    mqtt.publish((topicBase + "status").c_str(), "offline", true);
    mqtt.disconnect(); delay(200);
#ifdef ESP8266
    BearSSL::WiFiClientSecure c;
    c.setTrustAnchors(&trustAnchors);
#else
    WiFiClientSecure c;
    c.setCACert(ISRG_ROOT_X1);
#endif
    httpUpdateT.rebootOnUpdate(true);
    t_httpUpdate_return r = httpUpdateT.update(c, String("https://") + cfg.apiHost + url, FW_VERSION);
    if (r == HTTP_UPDATE_FAILED) {
        lastError = String("ota: ") + httpUpdateT.getLastErrorString();
        Serial.printf("[ota] failed: %s\n", lastError.c_str());
    }
    // при успіху плата перезавантажується
}

// ------------------------------------------------------------ status page

void webStatus() {
    String h = F("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Deye ESP</title>"
        "<style>body{font-family:system-ui;background:#111;color:#eee;padding:1.5em;max-width:40em}code{background:#222;padding:.1em .4em;border-radius:4px}"
        "b.big{font-size:2em;letter-spacing:.15em}</style><h2>☀ Deye ESP</h2>");
    h += "<p>Пристрій: <code>" + deviceId + "</code> · прошивка " FW_VERSION " · канал " + cfg.channel + "</p>";
    h += "<p>Код привʼязки в кабінеті " + String(cfg.apiHost) + ":<br><b class=big>" + (cfg.claimCode[0] ? String(cfg.claimCode) : String("—")) + "</b></p>";
    h += String("<p>Реєстрація: ") + (cfg.registered[0] == '1' ? "ок" : "ще ні") + " · MQTT: " + (mqtt.connected() ? "підключено" : "немає") +
         " · стік: " + (stick.known ? stick.ip.toString() + " (" + String(stick.serial) + ")" : String("шукаю")) + "</p>";
    h += "<p>WiFi " + WiFi.SSID() + " " + String(WiFi.RSSI()) + " dBm · вільно " + String(ESP.getFreeHeap()) + " B · uptime " + String(millis() / 1000) + " с</p>";
    if (lastError.length()) h += "<p style=color:#f88>Помилка: " + lastError + "</p>";
    web.send(200, "text/html; charset=utf-8", h);
}

void webStatusJson() {
    JsonDocument doc;
    doc["id"] = deviceId; doc["fw"] = FW_VERSION; doc["hw"] = HW_NAME; doc["channel"] = cfg.channel;
    doc["registered"] = cfg.registered[0] == '1'; doc["claim_code"] = cfg.claimCode; doc["mqtt"] = mqtt.connected();
    doc["stick_ip"] = stick.known ? stick.ip.toString() : ""; doc["stick_serial"] = stick.serial;
    doc["rssi"] = WiFi.RSSI(); doc["heap"] = ESP.getFreeHeap(); doc["error"] = lastError;
    String out; serializeJson(doc, out);
    web.send(200, "application/json", out);
}

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
        if (doc["channel"].is<const char*>() && strcmp(cfg.channel, doc["channel"])) {
            strlcpy(cfg.channel, doc["channel"], sizeof cfg.channel); saveConfig();
        }
        Serial.printf("[cfg] %u ranges, interval %u ms, channel %s\n", rangeCount, pollIntervalMs, cfg.channel);
    } else if (t.endsWith("/cmd")) {
        const char* cmd = doc["cmd"] | "";
        if (!strcmp(cmd, "poll")) pollNow = true;
        else if (!strcmp(cmd, "update")) otaRequested = true;
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
        else if (!strcmp(cmd, "mqtt")) {   // {"cmd":"mqtt","host":"...","port":8883,"user":"...","pass":"...","tls":true}
            if (doc["host"].is<const char*>()) strlcpy(cfg.mqttHost, doc["host"], sizeof cfg.mqttHost);
            if (doc["port"].is<int>()) snprintf(cfg.mqttPort, sizeof cfg.mqttPort, "%d", doc["port"].as<int>());
            if (doc["user"].is<const char*>()) strlcpy(cfg.mqttUser, doc["user"], sizeof cfg.mqttUser);
            if (doc["pass"].is<const char*>()) strlcpy(cfg.mqttPass, doc["pass"], sizeof cfg.mqttPass);
            if (doc["tls"].is<bool>()) strlcpy(cfg.mqttTls, doc["tls"].as<bool>() ? "1" : "0", sizeof cfg.mqttTls);
            saveConfig();
            Serial.printf("[cmd] mqtt -> %s:%s tls=%s, reboot\n", cfg.mqttHost, cfg.mqttPort, cfg.mqttTls);
            mqtt.publish((topicBase + "status").c_str(), "offline", true);
            delay(300); ESP.restart();
        }
    }
}

bool mqttConnect() {
    if (!cfg.mqttHost[0]) return false;
    if (cfg.mqttTls[0] == '1' || cfg.mqttTls[0] == '2') {
        if (cfg.mqttTls[0] == '1') {
            if (!waitForTime(15000)) { Serial.println("[mqtt] waiting for NTP before TLS"); return false; }
#ifdef ESP8266
            mqttTlsNet.setTrustAnchors(&trustAnchors);
#else
            mqttTlsNet.setCACert(ISRG_ROOT_X1);
#endif
        } else {
            mqttTlsNet.setInsecure();
        }
#ifdef ESP8266
        mqttTlsNet.setBufferSizes(1024, 1024);  // Mosquitto підтримує MFLN: ~16 KB замість 32
#endif
        mqtt.setClient(mqttTlsNet);
    } else {
        mqtt.setClient(mqttNet);
    }
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
#ifdef ESP8266
        char sslErr[80] = ""; mqttTlsNet.getLastSSLError(sslErr, sizeof sslErr);
        Serial.printf("[mqtt] connect failed rc=%d ssl='%s' heap=%u\n", mqtt.state(), sslErr, ESP.getFreeHeap());
        if (sslErr[0]) lastError = String("tls: ") + sslErr;
#else
        Serial.printf("[mqtt] connect failed rc=%d\n", mqtt.state());
#endif
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
    ensureCredentials();
#ifdef ESP8266
    Update.installSignature(&otaHash, &otaSign);   // приймати лише підписані образи
#endif

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
    WiFiManagerParameter pTls("mqtt_tls", "MQTT TLS: 0 ні, 1 з перевіркою, 2 без перевірки", cfg.mqttTls, sizeof cfg.mqttTls - 1);
    WiFiManagerParameter pApi("api_host", "Сервер платформи", cfg.apiHost, sizeof cfg.apiHost - 1);
    String claimHtml = "<p style='font-size:1.1em'>Пристрій <b>" + deviceId + "</b><br>Код привʼязки в кабінеті: <b style='font-size:1.6em;letter-spacing:.15em'>" + String(cfg.claimCode) + "</b></p>";
    WiFiManagerParameter pClaim(claimHtml.c_str());
    for (auto* p : {&pClaim, &pApi, &pHost, &pPort, &pUser, &pPass, &pIp, &pSn, &pPoll, &pTls}) wm.addParameter(p);
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
        strlcpy(cfg.mqttTls, pTls.getValue(), sizeof cfg.mqttTls);
        if (pApi.getValue()[0]) strlcpy(cfg.apiHost, pApi.getValue(), sizeof cfg.apiHost);
        saveConfig();
        Serial.println("[cfg] saved");
    }
    Serial.printf("[wifi] %s ip=%s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());

    pollIntervalMs = constrain(atoi(cfg.pollSec), 2, 600) * 1000;
    if (cfg.stickSerial[0]) stick.serial = strtoul(cfg.stickSerial, nullptr, 10);

    configTime(0, 0, "pool.ntp.org", "time.google.com");
    web.on("/", webStatus); web.on("/status.json", webStatusJson); web.begin();
    Serial.printf("[web] status page at http://%s/\n", WiFi.localIP().toString().c_str());

    if (cfg.registered[0] != '1') registerDevice();
    mqttConnect();
}

// --------------------------------------------------------------------- loop

uint32_t lastMqttTry = 0;

void loop() {
    if (WiFi.status() != WL_CONNECTED) { delay(500); return; }
    web.handleClient();

    static uint32_t lastRegTry = 0;
    if (cfg.registered[0] != '1' && millis() - lastRegTry > 60000) { lastRegTry = millis(); registerDevice(); }

    if (otaRequested || (mqtt.connected() && millis() > 120000 && (lastOtaCheck == 0 || millis() - lastOtaCheck > 6UL * 3600UL * 1000UL))) {
        bool force = otaRequested; otaRequested = false;
        checkOta(force);
        if (!mqtt.connected()) mqttConnect();
    }

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
