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

## Сертифікат Samsung (ТБ 2018+)

UE40K5500 (Tizen 2.4) приймає звичайний сертифікат Tizen. QE65QN80F (2025, Tizen 10) відкидає його
(`Check certificate error: Invalid certificate chain`) — потрібен сертифікат Samsung: автор + дистриб'ютор з переліком
DUID телевізорів (за форумами Samsung — до 50 на сертифікат). Новий ТБ = новий сертифікат з усіма DUID і перепідпис.

DUID: `~/tizen-studio/tools/sdb -s <ip-тб>:26101 shell 0 getduid`.

Certificate Manager з Tizen Studio на Arch не ставиться (менеджер пакетів вимагає ubuntu-залежності libkf5*), тому —
[tizencertificates](https://github.com/sreyemnayr/tizencertificates): бере адреси й CA з офіційного Samsung Certificate
Extension, вхід — у браузері на сторінці Samsung, ключі генерує локально openssl, на `dev.tizen.samsung.com` іде лише CSR.
Запускати вручну (сторонній код), звантаження розширення ~44 МБ з повільного download.tizen.org — кілька хвилин:

```
W=~/.config/sunhunter/tizen-samsung; mkdir -p $W && chmod 700 $W && cd $W
set -a; . ~/.config/sunhunter/tizen-signing.env; set +a
uv run --project <клон tizencertificates> tv --device-id "DUID1,DUID2" --email <пошта Samsung> --cert-password "$TIZEN_CERT_PASSWORD"
# браузер -> вхід Samsung (саме у вкладці, яку відкрила утиліта) -> certificates/author.p12, distributor.p12
C=$W/certificates
$T/tizen security-profiles add -n SunHunterSamsung -a $C/author.p12 -p "$TIZEN_CERT_PASSWORD" -d $C/distributor.p12 -dp "$TIZEN_CERT_PASSWORD"
$T/tizen package -t wgt -s SunHunterSamsung -- /tmp/tizen-build      # далі install/run як вище
```

Поточний сертифікат (2026-11-13): автор andriy@netlife.com.ua, DUID `ZPCGVGAGO6YHG` (QE65QN80F, 192.168.0.200),
дійсний до 2027-11-13. Застосунок, підписаний іншим автором, ставиться лише після видалення старого.

На QN80F: режим розробника з'явився лише через Apps → шестерня (керування застосунками) → `12345`, а `sdb` відкрився
тільки після вимкнення з розетки. Масово клієнтам — лише через Samsung Apps TV (TV Seller Office; для hosted web app,
за відповіддю на форумі Samsung, потрібне партнерство, перевірка від ~4 тижнів).
