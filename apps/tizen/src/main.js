// Обгортка над екраном ТБ для Samsung Tizen (2016+): сторінка /tv у фреймі на весь екран.
// Пара за кодом і токен — як у браузері: /tv -> /s/<token>, токен у localStorage домену tv.sun-hunter.men.
var TV_URL = 'https://tv.sun-hunter.men/tv';
var frame = document.getElementById('tv');
var hint = document.getElementById('hint');

function load() { frame.src = TV_URL + '?_=' + Date.now(); }   // свіжий параметр — щоб src справді змінився

// Заставка й вимкнення екрана за бездіяльністю — дашборд має світити весь день.
function keepScreenOn() {
  try { webapis.appcommon.setScreenSaver(webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF); } catch (e) {}
}

// Мережа зникла й повернулась — перезавантажуємо сторінку, як Android-обгортка.
var wasOffline = false;
window.addEventListener('offline', function () { wasOffline = true; });
window.addEventListener('online', function () { if (wasOffline) { wasOffline = false; setTimeout(load, 3000); } });

// «Назад» виходить лише з другого натискання за 3 с, щоб дашборд не закрили випадково.
var backAt = 0, hintTimer = 0;
document.addEventListener('keydown', function (e) {
  if (e.keyCode !== 10009) return;
  e.preventDefault();
  var now = Date.now();
  if (now - backAt < 3000) { try { tizen.application.getCurrentApplication().exit(); } catch (x) {} return; }
  backAt = now;
  hint.style.display = 'block';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(function () { hint.style.display = 'none'; }, 3000);
});

// Після повернення застосунку з фону (кнопка Home і назад) — свіжа сторінка й знову без заставки.
document.addEventListener('visibilitychange', function () { if (!document.hidden) { keepScreenOn(); load(); } });

keepScreenOn();
load();
