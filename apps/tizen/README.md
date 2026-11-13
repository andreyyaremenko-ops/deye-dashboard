# SunHunter TV для Samsung Tizen

Обгортка над екраном ТБ для телевізорів Samsung (Tizen 2.4+, перевірено на UE40K5500 2016 року): `/tv` на весь екран
у фреймі, пара за кодом і токен — як у браузері. Ще застосунок вимикає заставку, перезавантажує сторінку після
обриву мережі й повернення з фону і виходить лише з другого натискання «Назад».

Старі Tizen (2.4 — WebKit 538, лише ES5) тягнуть legacy-збірку `apps/tv` (`@vitejs/plugin-legacy` + ES5-прохід Babel
у `apps/tv/vite.config.ts`, заглушки BigInt / defineProperty у `apps/tv/index.html`). Без неї екран чорний і в браузері ТБ.

## Збирання і встановлення

Потрібен Tizen Studio CLI (`web-cli_Tizen_Studio_<версія>_ubuntu-64.bin` з download.tizen.org/sdk/Installer) у `~/tizen-studio`.

```
set -a; . ~/.config/sunhunter/tizen-signing.env; set +a      # TIZEN_CERT_PASSWORD, поза репо
T=~/tizen-studio/tools/ide/bin
# один раз: сертифікат автора і профіль підпису
$T/tizen certificate -a SunHunter -p "$TIZEN_CERT_PASSWORD" -f sunhunter-tizen
$T/tizen security-profiles add -n SunHunter -a ~/tizen-studio-data/keystore/author/sunhunter-tizen.p12 -p "$TIZEN_CERT_PASSWORD"
$T/tizen cli-config "profiles.path=$HOME/tizen-studio-data/profile/profiles.xml"

cp -r src /tmp/tizen-build && $T/tizen package -t wgt -s SunHunter -- /tmp/tizen-build
mv "/tmp/tizen-build/SunHunter TV.wgt" /tmp/SunHunterTV.wgt   # install не бере назву з пробілом
~/tizen-studio/tools/sdb connect <ip-тб>
$T/tizen install -s <ip-тб>:26101 -n SunHunterTV.wgt -- /tmp
$T/tizen run -s <ip-тб>:26101 -p SunHntrTV0.SunHunterTV
```

Сертифікат автора не втрачати: новішу версію з іншим підписом ТБ не поставить поверх старої (лише видалити й заново).

## Режим розробника на ТБ

Smart Hub → Apps, на пульті `12345` (на пульті без цифр — кнопка `123` або цифри з мережі через
`wss://<ip-тб>:8002/api/v2/channels/samsung.remote.control`, `KEY_1`…`KEY_5`), Developer mode **On**, Host PC IP —
адреса ПК, з якого ставите, потім перезавантаження з затиснутою кнопкою живлення. Перевірка: `curl http://<ip-тб>:8001/api/v2/`
→ `developerMode: "1"`, відкритий порт 26101.

Новіші моделі (2018+) можуть вимагати сертифікат Samsung, прив'язаний до DUID телевізора (Certificate Manager з
обліковим записом Samsung); UE40K5500 прийняв звичайний сертифікат Tizen.
