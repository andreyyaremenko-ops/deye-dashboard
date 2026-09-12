# Прошивка спайку: Wemos D1 mini (ESP8266) / ESP32

Читає Deye через Solarman-стік по V5 і шле сирі регістри в MQTT.

## Збірка та прошивка

```bash
uv tool install platformio          # один раз, якщо pio нема
cd firmware
pio test -e native                  # тести парсера на реальних дампах
pio run -e d1_mini -t upload        # D1 mini по USB
pio device monitor                  # лог 115200
```

Для ESP32: `-e esp32dev`.

## Перший запуск

1. Плата підіймає точку доступу `deye-XXXXXX`. Підключитись телефоном, відкриється портал.
2. Вибрати WiFi, ввести MQTT host/port (для спайку — Mosquitto на ноутбуці), решту можна лишити порожнім: стік знайдеться сам.
3. Портал відкривається знову, якщо при старті D5 замкнути на GND (ESP32: кнопка BOOT), або командою `{"cmd":"portal"}`.

## Локальний брокер для тесту

Якщо docker недоступний, без sudo працює Python-брокер:

```bash
printf 'listeners:\n  default:\n    type: tcp\n    bind: 0.0.0.0:1883\nauth:\n  allow-anonymous: true\ntopic-check:\n  enabled: false\n' > amqtt.yaml
uvx --from amqtt amqtt -c amqtt.yaml
```

На Arch з ufw треба відкрити порт: `sudo ufw allow 1883/tcp`. Порт плати:
`sudo chmod a+rw /dev/ttyUSB0` або додати себе в групу `uucp`.

```bash
docker run -d --name mqtt -p 1883:1883 eclipse-mosquitto:2 sh -c \
  "printf 'listener 1883\nallow_anonymous true\n' > /mosquitto/config/mosquitto.conf && /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf"
mosquitto_sub -h localhost -t 'devices/#' -v
```

## Як плата знаходить стік

1. Кешований IP з попереднього разу: пробний V5-кадр, перевірка серійника.
2. UDP broadcast `WIFIKIT-214028-READ`. Частина стіків (зокрема LSW-3 з новою
   прошивкою) на нього не відповідає взагалі, ні broadcast, ні unicast.
3. Скан /24 по TCP 8899 з пробним V5-кадром. Серійник вводити не треба: стік
   відповідає на кадр із будь-яким серійником, підставляючи свій у заголовок.
   Триває до 3 хв, зазвичай близько хвилини.

Знайдений IP кешується у LittleFS. Раз на годину або після 3 провалів підряд
IP перевіряється і за потреби пошук повторюється.

## Теми MQTT

| Тема | Напрям | Зміст |
|---|---|---|
| `devices/<id>/status` | пристрій → | `online` / `offline` (retained, LWT) |
| `devices/<id>/info` | пристрій → | fw, hw, ip, rssi, stick_ip, stick_serial, heap (retained) |
| `devices/<id>/telemetry` | пристрій → | `{"seq","ts","uptime","stick","ranges":[{"start":500,"regs":"<hex>"}]}` |
| `devices/<id>/cfg` | → пристрій | `{"ranges":[[0,22],[500,700]],"interval":10}` (retained) |
| `devices/<id>/cmd` | → пристрій | `{"cmd":"poll"}`, `{"cmd":"reboot"}`, `{"cmd":"portal"}`, `{"cmd":"rediscover","nocache":true,"scan_ms":700}`, `{"cmd":"stick","ip":"192.168.1.126"}` (серійник необовʼязковий, дізнається сам) |

`<id>` — MAC чипа без двокрапок. `regs` — по 4 hex-символи на регістр, big-endian, як у Modbus.
`ts` — epoch з NTP або 0, якщо час ще не синхронізований; сервер має брати свій час прийому.

## Продакшн-функції (з 0.2.0)

- **Самореєстрація.** При першому старті плата сама генерує секрет MQTT і 8-символьний
  код привʼязки, показує код у порталі та на сторінці статусу `http://<ip плати>/`,
  і реєструється на сервері (`POST /api/devices/register`). Наліпка не потрібна.
- **TLS з перевіркою сертифіката** (ISRG Root X1/X2, `src/certs.h`), потрібен NTP.
  `mqtt_tls`: 0 без TLS, 1 з перевіркою (за замовчуванням), 2 без перевірки.
- **Підписаний OTA.** Збірка підписує образ ключем `~/.deye/fw-signing/private.key`
  (`sign.py`), плата приймає лише образи з підписом під `src/fw_pubkey.h`.
  Перевірка версії раз на 6 год і за командою `{"cmd":"update"}`; канал stable/beta
  приходить у `cfg`. Публікація нової версії (superadmin, кабінет або curl):
  `POST /api/admin/firmware` multipart: file=firmware.bin.signed, hw, channel, version.
- Сторінка статусу плати: `http://<ip>/` і `/status.json`.

Обмеження ESP8266: TLS-зʼєднань по одному (реєстрація й OTA йдуть при
відключеному MQTT), ~30 KB вільної памʼяті під час роботи.
