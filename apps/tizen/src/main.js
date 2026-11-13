// Обгортка над екраном ТБ для Samsung Tizen (2016+): сторінка /tv у фреймі на весь екран.
// Пара за кодом і токен — як у браузері: /tv -> /s/<token>, токен у localStorage домену tv.sun-hunter.men.
var TV_URL = 'https://tv.sun-hunter.men/tv';
var TV_ORIGINS = ['https://tv.sun-hunter.men', 'http://tv.sun-hunter.men'];
var frame = document.getElementById('tv');
var hint = document.getElementById('hint');

// За цим ім'ям сторінка знає, що вона в застосунку, і віддає радіо сюди (apps/tv/src/native.ts, TIZEN_FRAME)
frame.name = 'sunhunter-tizen';

function load() { radioStop(); frame.src = TV_URL + '?_=' + Date.now(); }   // свіжий параметр — щоб src справді змінився

// --- Радіо через AVPlay --------------------------------------------------------------------------------------------
// На Tizen 2.4 <video> і <audio> у сторінці разом не грають (відеофон стає на паузу), а <video> і AVPlay — грають.
// Власної гучності AVPlay не має (лише гучність усього ТБ), тому налаштування гучності радіо тут не діє, а
// притишення на час сповіщення (radioVolume з меншим значенням) — це пауза до відновлення гучності.
var radio = { url: null, volume: 1, ducked: false, retryTimer: 0 };

function avClose() {
  clearTimeout(radio.retryTimer);
  try { webapis.avplay.stop(); } catch (e) {}
  try { webapis.avplay.close(); } catch (e) {}
}

function retryLater() {
  clearTimeout(radio.retryTimer);
  radio.retryTimer = setTimeout(function () { if (radio.url && !radio.ducked) avStart(); }, 5000);
}

function avStart() {
  avClose();
  try {
    var av = webapis.avplay;
    av.open(radio.url);
    av.setListener({ onerror: retryLater, onstreamcompleted: retryLater });
    av.prepareAsync(function () { try { av.play(); } catch (e) { retryLater(); } }, retryLater);
  } catch (e) { retryLater(); }
}

function radioStop() { radio.url = null; radio.ducked = false; avClose(); }

window.addEventListener('message', function (e) {
  if (e.source !== frame.contentWindow || TV_ORIGINS.indexOf(e.origin) < 0) return;
  var m = e.data;
  if (!m || m.sunhunter !== 1) return;
  if (m.cmd === 'radioPlay' && typeof m.url === 'string') {
    radio.url = m.url; radio.volume = m.volume; radio.ducked = false; avStart();
  } else if (m.cmd === 'radioStop') {
    radioStop();
  } else if (m.cmd === 'radioVolume' && radio.url) {
    if (m.volume < radio.volume * 0.75) { if (!radio.ducked) { radio.ducked = true; avClose(); } }
    else { radio.volume = m.volume; if (radio.ducked) { radio.ducked = false; avStart(); } }
  }
});

// --- Екран і пульт -------------------------------------------------------------------------------------------------
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
  if (now - backAt < 3000) { radioStop(); try { tizen.application.getCurrentApplication().exit(); } catch (x) {} return; }
  backAt = now;
  hint.style.display = 'block';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(function () { hint.style.display = 'none'; }, 3000);
});

// У фоні (кнопка Home) радіо замовкає; після повернення — свіжа сторінка, вона сама знову попросить радіо.
document.addEventListener('visibilitychange', function () {
  if (document.hidden) radioStop();
  else { keepScreenOn(); load(); }
});

keepScreenOn();
load();
