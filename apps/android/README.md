# SunHunter TV для Android TV

Тонка обгортка над екраном ТБ: повноекранний WebView з `https://<домен>/tv` (пара за кодом,
далі `/s/<token>`, токен у localStorage WebView) і нативне радіо на Media3 ExoPlayer.

Навіщо: частина ТБ-браузерів грає лише один медіаелемент, і відеофон ставить радіо на паузу
(тоді сторінка перемикається на кадр замість відео). У застосунку звук декодується поза
WebView, тому відеофон і радіо грають разом. Сторінка дізнається про застосунок через
`window.SunHunterTv` (`Bridge.kt` ↔ `apps/tv/src/native.ts`).

Ще застосунок: тримає екран увімкненим, запускається після ввімкнення ТБ, перезавантажує
сторінку при обриві мережі, піднімає WebView знову, якщо процес рендера впав, і виходить лише
з другого натискання «Назад».

## Збирання

Потрібні JDK 21 і Android SDK (platform 36). Без Android Studio:

```
mise install java@temurin-21
# SDK: commandlinetools з developer.android.com/studio -> ~/Android/Sdk/cmdline-tools/latest
sdkmanager "platforms;android-36" "platform-tools"
export JAVA_HOME=$(mise where java@temurin-21) ANDROID_HOME=~/Android/Sdk
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease      # підпис — змінні ANDROID_KEY* з .env.example
./gradlew assembleDebug -PtvUrl=https://інший-домен/tv
```

## Встановлення на ТБ

1. На ТБ: Налаштування → Про пристрій → 7 разів «Збірка» → Для розробників → Налагодження по мережі.
2. `adb connect <ip-тб>` і `adb install -r app-debug.apk` (або APK через Downloader by AFTVnews).
3. Автозапуск після ввімкнення ТБ на Android 10+ потребує дозволу, який з меню ТБ не видати:
   `adb shell appops set men.sunhunter.tv SYSTEM_ALERT_WINDOW allow`

Журнал: `adb logcat | grep -iE "chromium|ExoPlayer|sunhunter"`.

## Обмеження

- Спектр (віджет `spectrum`) у застосунку поки малює синтетичну хвилю: звук іде повз Web Audio.
  Наступний крок — PCM з ExoPlayer (`TeeAudioProcessor`) → FFT → кадр у сторінку.
- Камери — так само `<video>` у WebView: на ТБ з одним декодером камера разом з відеофоном
  і далі перемикає фон на кадр.
