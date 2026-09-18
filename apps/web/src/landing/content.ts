/**
 * Тексти лендінгу двома мовами. Єдине джерело і для сторінки, і для SEO-розмітки (title, description, Open Graph,
 * JSON-LD з FAQ, hreflang, sitemap) — її генерує scripts/prerender.tsx під час збірки.
 * Позиціонування: перш за все електронне меню / digital signage; віджети сонячної станції — додаток.
 */
export type Lang = "uk" | "en";
export const LANGS: Lang[] = ["uk", "en"];
export const SITE = "https://tv.sun-hunter.men";
export const pathOf = (lang: Lang) => (lang === "uk" ? "/" : "/en");
export const langOfPath = (path: string): Lang => (path === "/en" || path.startsWith("/en/") ? "en" : "uk");

type Card = [icon: string, title: string, text: string];
export interface LandingContent {
  htmlLang: string; ogLocale: string;
  meta: { title: string; description: string; ogTitle: string; ogDescription: string; appDescription: string };
  nav: { signage: string; how: string; features: string; energy: string; pricing: string; faq: string; login: string; cabinet: string; tryFree: string; otherLang: string };
  hero: { eyebrow: string; h1a: string; h1em: string; lead: string; cta: string; how: string; notes: string[]; tvBar: string; live: string; chips: [string, string][]; watchLive: string; videoAlt: string; imgAlt: string };
  signage: { kicker: string; title: string; lead: string; cards: Card[] };
  how: { kicker: string; title: string; steps: [string, string][] };
  features: { kicker: string; title: string; bigTag: string; bigTitle: string; bigText: string; stats: [string, string][]; cards: Card[]; wide: string[] };
  energy: { kicker: string; title: string; lead: string; cards: Card[] };
  pricing: { kicker: string; title: string; lead: string; forever: string; perMonth: string; proNote: string; badge: string; onRequest: string;
    free: string[]; pro: string[]; max: string[]; start: string; goPro: string; discuss: string; payNote: string };
  faq: { kicker: string; title: string; items: [string, string][] };
  diy: { title: string; text: string; repo: string };
  foot: { contact: string; made: string };
}

const uk: LandingContent = {
  htmlLang: "uk", ogLocale: "uk_UA",
  meta: {
    title: "Електронне меню на телевізор для кафе і магазинів — SunHunter TV",
    description: "Меню-борд і digital signage на будь-якому Smart TV: меню з цінами, сцени за розкладом, відеофони, QR-коди, радіо. Плюс віджети сонячної станції Deye. Безкоштовний тариф назавжди, відкритий код.",
    ogTitle: "SunHunter TV — електронне меню і digital signage на телевізорі закладу",
    ogDescription: "Зберіть екран у редакторі, відкрийте посилання на телевізорі. Меню, сцени за розкладом, відеофони, QR, радіо, а для закладів на сонці — батарея і час автономії наживо.",
    appDescription: "Сервіс електронних меню та digital signage для кафе, магазинів і офісів на Smart TV: меню з цінами, сцени за розкладом, відеофони, QR-коди, онлайн-радіо, віджети сонячної станції Deye.",
  },
  nav: { signage: "Меню-борд", how: "Як це працює", features: "Можливості", energy: "Сонячна станція", pricing: "Тарифи", faq: "Питання", login: "Увійти", cabinet: "Кабінет", tryFree: "Спробувати безкоштовно", otherLang: "EN" },
  hero: {
    eyebrow: "Електронне меню · digital signage · будь-який Smart TV",
    h1a: "Електронне меню на", h1em: "телевізорі вашого закладу",
    lead: "Перетворіть телевізор у залі на меню-борд: меню з цінами, сцени за розкладом, відео на фоні, QR-коди, Wi-Fi для гостей і радіо. Збираєте екран у вебредакторі, телевізор відкриває одне посилання і далі оновлюється сам. А якщо заклад працює від інвертора Deye, на тому ж екрані буде сонячна станція наживо і час автономії під час відключень.",
    cta: "Створити екран безкоштовно", how: "Як це працює",
    notes: ["Безкоштовний тариф назавжди", "Без додаткового обладнання", "Відкритий код"],
    tvBar: "SunHunter TV · Зал", live: "LIVE · оновлення 10 с",
    chips: [["🧾", "Меню оновлено щойно"], ["⏱", "Сніданки до 12:00"], ["🔋", "64 % · вистачить ≈ 6 год"]],
    watchLive: "▶ Подивитись наживо",
    videoAlt: "Екран SunHunter TV на телевізорі в кафе: електронне меню з цінами, відеофон, показники сонячної станції, годинник",
    imgAlt: "Електронне меню SunHunter TV на телевізорі в кафе: меню закладу з цінами на тлі відео каміна, заряд батареї, годинник",
  },
  signage: {
    kicker: "Меню-борд і реклама", title: "Меню, яке оновлюється за хвилину",
    lead: "Змінили ціну чи додали страву в кабінеті — за секунду це вже на телевізорі. Без флешок, дизайнера і друку.",
    cards: [
      ["🧾", "Меню з цінами", "Розділи, позиції й ціни зі звичайного тексту. Девʼять шрифтів з кирилицею, розмір і кольори під стиль закладу."],
      ["⏱", "Сцени за розкладом", "До десяти виглядів на один телевізор: сніданки до полудня, бізнес-ланч, вечірнє меню. Змінюються за таймером або за годинами."],
      ["🎞", "Фони, QR і радіо", "Понад 30 відеофонів або власні відео й фото. QR на Instagram чи гостьовий Wi-Fi, 14 радіостанцій одним кліком."],
    ],
  },
  how: {
    kicker: "Швидкий старт", title: "Як це працює",
    steps: [
      ["Збираєте екран у кабінеті", "Перетягуєте віджети на полотні, вписуєте меню, обираєте фон. Зміни зʼявляються на телевізорі одразу."],
      ["Телевізор відкриває tv.sun-hunter.men/tv", "Вводите шестизначний код із кабінету. Далі телевізор памʼятає екран сам, навіть після вимкнення."],
      ["За бажанням підключаєте інвертор", "Три поля на сторінці Wi-Fi-стіка Solarman, і на екрані зʼявляються сонце, батарея та час автономії. Застосунок Solarman працює як раніше."],
    ],
  },
  features: {
    kicker: "Можливості та віджети", title: "Що на екрані",
    bigTag: "Головний модуль", bigTitle: "Меню закладу",
    bigText: "Багаторядкове меню з розділами й цінами, великий читабельний шрифт, кольори й картка під інтерʼєр. Оновили в кабінеті — оновилось на всіх телевізорах.",
    stats: [["Еспресо", "45 ₴"], ["Капучино", "65 ₴"], ["Чізкейк", "95 ₴"]],
    cards: [
      ["⏱", "Сцени та розклад", "Кілька виглядів на один телевізор з таймером і годинами показу."],
      ["🎞", "Відеофони", "Камін, водоспад, акваріум, дощ за вікном: понад 30 кліпів з ліцензією для закладів, або власні відео та фото."],
      ["🔲", "QR-коди", "Wi-Fi для гостей одним сканом, меню, Instagram чи відгуки. Просто вставте посилання або пароль."],
      ["📻", "Онлайн-радіо", "14 українських станцій одним кліком у кабінеті, перемикання без перезавантаження телевізора."],
      ["🚨", "Повітряна тривога", "Стан вашої області на екрані і банер на весь телевізор під час тривоги. Без ключів і налаштувань, лише виберіть область."],
      ["🌤", "Погода і сонце на завтра", "Температура, вітер, захід сонця, а для сонячних станцій ще й прогноз генерації на завтра."],
      ["☀", "Показники станції наживо", "Сонце, батарея, мережа, споживання і потік енергії. Оновлення кожні 10 секунд."],
      ["📈", "Графіки й еко-статистика", "Крива генерації за добу на екрані, історія за рік у кабінеті, кВт·год від сонця і збережений CO₂ за місяць."],
    ],
    wide: ["Повітряна тривога", "Погода і сонце на завтра"],
  },
  energy: {
    kicker: "Для закладів на сонці", title: "Коли вимкнули світло",
    lead: "Якщо заклад живиться від гібридного інвертора Deye, екран відповідає на головне питання персоналу сам: скільки ще протримаємось.",
    cards: [
      ["⚡", "Мережі немає — екран покаже одразу", "Віджет мережі стає червоним: «світло вимкнено, працюємо від батареї». Можна закріпити окрему сцену на час відключення."],
      ["🔋", "Скільки годин лишилось", "Залишок батареї і прогноз «≈ 3 год 20 хв при поточному споживанні». Впав нижче 40% — жовтий, наближається до мінімуму — червоний."],
      ["🍳", "Що можна вмикати", "Споживання наживо: увімкнули гриль чи бойлер — цифра і прогноз змінились тут же. Персонал сам вирішує, що відкласти до світла."],
    ],
  },
  pricing: {
    kicker: "Прозорі тарифи", title: "Тарифи",
    lead: "Код відкритий, можна підняти на власному сервері. Платна підписка свідомо коштує не більше за оренду такого сервера.",
    forever: " / назавжди", perMonth: " / міс", badge: "Найпопулярніший", onRequest: "за домовленістю",
    proNote: "Пів року — 3000 ₴ (місяць у подарунок), рік — 6000 ₴ (два місяці у подарунок)",
    free: ["1 телевізор і 1 логер інвертора", "Увесь функціонал: меню, сцени, власні відеофони й фото, радіо", "Історія та графіки за рік", "Невеликий напис SunHunter TV і плашка з QR раз на 10 хвилин"],
    pro: ["До 5 телевізорів і 5 логерів", "Увесь функціонал, як у Free", "Без брендингу на екрані", "Пріоритетна підтримка"],
    max: ["Мережа закладів: до 50 телевізорів і логерів", "Інші бренди інверторів", "Персональні віджети й брендування", "Пріоритетна підтримка"],
    start: "Почати", goPro: "Підключити Pro", discuss: "Обговорити", payNote: "Оплата карткою в кабінеті через monobank",
  },
  faq: {
    kicker: "Часті запитання", title: "Все, що треба знати перед підключенням",
    items: [
      ["Чи потрібен інвертор або сонячна станція?", "Ні. Електронне меню, сцени, відеофони, QR-коди, радіо, погода й тривога працюють на будь-якому телевізорі без жодного обладнання. Віджети сонячної станції — додаткова можливість для закладів з інвертором Deye."],
      ["Як оновлювати меню?", "У кабінеті з телефона чи компʼютера: змінюєте текст, ціну або сцену, натискаєте «Зберегти», і за секунду нове меню вже на телевізорі. Нічого не треба нести на флешці чи перезапускати."],
      ["Які телевізори підходять?", "Будь-який Smart TV з браузером: Samsung, LG, Android TV, або приставка. На телевізорі відкриваєте tv.sun-hunter.men/tv і вводите шестизначний код із кабінету."],
      ["Чи можна показувати різне меню вранці та ввечері?", "Так. На одному телевізорі може бути до десяти сцен. Кожна має свій час показу і необовʼязковий розклад за годинами, наприклад сніданки з 8:00 до 12:00."],
      ["Скільки це коштує?", "Тариф Free безкоштовний назавжди і має весь функціонал: один телевізор і один логер, усі віджети, власні відеофони й фото, радіо, історія за рік. Pro — 600 ₴ на місяць: те саме на 5 телевізорів і 5 логерів, без брендингу на екрані. Оплата карткою через monobank."],
      ["Які інвертори підтримуються?", "Гібридні інвертори Deye: однофазні SG0xLP1, трифазні низьковольтні SG04LP3 і високовольтні SG01HP3. Дані читаються через Wi-Fi-стік Solarman, який уже є в інверторі; застосунок Solarman продовжує працювати. Інші бренди підключаємо за запитом у тарифі Max."],
      ["Що бачить персонал під час відключення світла?", "Червоний банер «світла немає з 14:20», залишок батареї у відсотках і прогноз «вистачить ≈ 3 год 20 хв при поточному споживанні». Увімкнули гриль — прогноз перерахувався одразу."],
      ["Чи можна розгорнути сервіс у себе?", "Так. Код відкритий за ліцензією AGPL-3.0 і лежить на GitHub. Для власного сервера достатньо VDS на 2 ядра і 2 ГБ памʼяті."],
    ],
  },
  diy: { title: "Відкритий код", text: "Проєкт відкритий за ліцензією AGPL-3.0: сервер, кабінет, екран для ТБ і прошивка для ESP8266/ESP32 з підписаними оновленнями. Протокол обміну з інвертором задокументований. Репозиторій:", repo: "deye-dashboard на GitHub" },
  foot: { contact: "Контакт", made: "Зроблено в Україні 🇺🇦" },
};

const en: LandingContent = {
  htmlLang: "en", ogLocale: "en_US",
  meta: {
    title: "Digital menu boards for any Smart TV — SunHunter TV signage",
    description: "Digital menu board and signage software for cafés, shops and offices: menus with prices, scheduled scenes, video backgrounds, QR codes, radio, plus live Deye solar widgets. Free plan forever, open source.",
    ogTitle: "SunHunter TV — digital menu boards and signage on the TV you already have",
    ogDescription: "Build a screen in the web editor, open one link on the TV. Menus, scheduled scenes, video backgrounds, QR codes, radio, and for solar-powered venues, live battery and blackout runtime.",
    appDescription: "Digital menu board and signage service for cafés, shops and offices on any Smart TV: menus with prices, scheduled scenes, video backgrounds, QR codes, online radio, and live Deye solar inverter widgets.",
  },
  nav: { signage: "Menu board", how: "How it works", features: "Features", energy: "Solar", pricing: "Pricing", faq: "FAQ", login: "Log in", cabinet: "Dashboard", tryFree: "Try it free", otherLang: "UA" },
  hero: {
    eyebrow: "Digital menu board · signage · any Smart TV",
    h1a: "A digital menu board on", h1em: "the TV you already have",
    lead: "Turn the TV on your wall into a menu board: a menu with prices, scenes on a schedule, video backgrounds, QR codes, guest Wi-Fi and radio. Build the screen in a web editor, open one link on the TV, and it stays in sync from then on. If your venue runs on a Deye inverter, the same screen also shows your solar station live and how long you can keep working through a blackout.",
    cta: "Create a screen for free", how: "How it works",
    notes: ["Free plan forever", "No extra hardware", "Open source"],
    tvBar: "SunHunter TV · Main hall", live: "LIVE · updates every 10 s",
    chips: [["🧾", "Menu updated just now"], ["⏱", "Breakfast until 12:00"], ["🔋", "64 % · about 6 h left"]],
    watchLive: "▶ Watch the live demo",
    videoAlt: "SunHunter TV screen on a café TV: a digital menu with prices, video background, solar station readings and a clock",
    imgAlt: "SunHunter TV digital menu board on a café TV: menu with prices over a fireplace video, battery level and a clock",
  },
  signage: {
    kicker: "Menu board and signage", title: "A menu you can update in a minute",
    lead: "Change a price or add a dish in the dashboard and it is on the TV a second later. No USB sticks, no designer, no printing.",
    cards: [
      ["🧾", "Menu with prices", "Sections, items and prices from plain text. Nine fonts, adjustable size and colours to match your venue."],
      ["⏱", "Scenes on a schedule", "Up to ten layouts per TV: breakfast until noon, lunch deals, an evening menu. They rotate by timer or by time of day."],
      ["🎞", "Backgrounds, QR and radio", "30+ looping video backgrounds or your own videos and photos. QR codes for Instagram or guest Wi-Fi, online radio in one click."],
    ],
  },
  how: {
    kicker: "Quick start", title: "How it works",
    steps: [
      ["Build the screen in the dashboard", "Drag widgets on the canvas, type in your menu, pick a background. Changes appear on the TV instantly."],
      ["Open tv.sun-hunter.men/tv on the TV", "Enter the six-digit code from the dashboard. The TV remembers the screen from then on, even after a power cut."],
      ["Optionally connect your inverter", "Three fields on the Solarman Wi-Fi stick settings page, and solar, battery and blackout runtime appear on the screen. The Solarman app keeps working."],
    ],
  },
  features: {
    kicker: "Features and widgets", title: "What goes on the screen",
    bigTag: "Core module", bigTitle: "Your menu",
    bigText: "A multi-section menu with prices in a large, readable font, with colours and a card style to suit your interior. Update it in the dashboard and every TV follows.",
    stats: [["Espresso", "45 ₴"], ["Cappuccino", "65 ₴"], ["Cheesecake", "95 ₴"]],
    cards: [
      ["⏱", "Scenes and schedule", "Several layouts on one TV with a timer and hours of display."],
      ["🎞", "Video backgrounds", "Fireplace, waterfall, aquarium, rain on the window: 30+ clips licensed for venues, or your own videos and photos."],
      ["🔲", "QR codes", "Guest Wi-Fi in one scan, your menu, Instagram or reviews. Just paste a link or a password."],
      ["📻", "Online radio", "14 Ukrainian stations, switched from the dashboard without touching the TV."],
      ["🚨", "Air-raid alerts", "The status of your region in Ukraine on screen and a full-screen banner during an alert. No keys or setup, just pick the region."],
      ["🌤", "Weather and tomorrow's sun", "Temperature, wind, sunset, and for solar stations a generation forecast for tomorrow."],
      ["☀", "Live solar readings", "Solar, battery, grid, load and an energy-flow diagram. Updated every 10 seconds."],
      ["📈", "Charts and eco stats", "The day's generation curve on screen, a year of history in the dashboard, monthly solar kWh and CO₂ saved."],
    ],
    wide: ["Air-raid alerts", "Weather and tomorrow's sun"],
  },
  energy: {
    kicker: "For solar-powered venues", title: "When the power goes out",
    lead: "If your venue runs on a Deye hybrid inverter, the screen answers the staff's main question by itself: how long can we keep going?",
    cards: [
      ["⚡", "Grid down: the screen shows it at once", "The grid widget turns red: \"power is out, running on battery\". You can pin a dedicated scene for the duration of an outage."],
      ["🔋", "Hours left", "Remaining battery and an estimate such as \"about 3 h 20 min at the current load\". Below 40% it turns yellow, near the minimum it turns red."],
      ["🍳", "What is safe to switch on", "Live consumption: turn on the grill or the boiler and both the number and the estimate change right away. Staff decide what can wait."],
    ],
  },
  pricing: {
    kicker: "Transparent pricing", title: "Pricing",
    lead: "The code is open, so you can run it on your own server. The paid plan is priced on purpose at no more than renting that server.",
    forever: " / forever", perMonth: " / month", badge: "Most popular", onRequest: "on request",
    proNote: "About $15. Six months for 3000 ₴ (one month free), a year for 6000 ₴ (two months free)",
    free: ["1 TV and 1 inverter logger", "Every feature: menu, scenes, own videos and photos, radio", "One year of history and charts", "A small SunHunter TV badge and a QR plaque every 10 minutes"],
    pro: ["Up to 5 TVs and 5 loggers", "Every feature, same as Free", "No branding on screen", "Priority support"],
    max: ["Chains: up to 50 TVs and loggers", "Other inverter brands", "Custom widgets and branding", "Priority support"],
    start: "Get started", goPro: "Get Pro", discuss: "Contact us", payNote: "Card payment in the dashboard via monobank",
  },
  faq: {
    kicker: "FAQ", title: "What to know before you start",
    items: [
      ["Do I need an inverter or a solar station?", "No. The digital menu, scenes, video backgrounds, QR codes, radio, weather and alerts work on any TV with no hardware at all. Solar widgets are an extra for venues with a Deye inverter."],
      ["How do I update the menu?", "In the dashboard, from a phone or a computer: change the text, a price or a scene, press Save, and a second later the new menu is on the TV. Nothing to carry on a USB stick, nothing to restart."],
      ["Which TVs are supported?", "Any Smart TV with a browser: Samsung, LG, Android TV, or a TV stick. Open tv.sun-hunter.men/tv on the TV and enter the six-digit code from the dashboard."],
      ["Can I show a different menu in the morning and in the evening?", "Yes. One TV can have up to ten scenes. Each has its own display time and an optional schedule, for example breakfast from 8:00 to 12:00."],
      ["How much does it cost?", "The Free plan is free forever with every feature: one TV and one logger, all widgets, your own videos and photos, radio, a year of history. Pro is 600 UAH per month (about $15): the same for 5 TVs and 5 loggers, with no branding on screen."],
      ["Which inverters are supported?", "Deye hybrid inverters: single-phase SG0xLP1, three-phase low-voltage SG04LP3 and high-voltage SG01HP3. Data is read through the Solarman Wi-Fi stick the inverter already has, and the Solarman app keeps working. Other brands on request in the Max plan."],
      ["What do staff see during a blackout?", "A red banner \"no grid power since 14:20\", the remaining battery in percent and an estimate \"about 3 h 20 min at the current load\". Turn on the grill and the estimate is recalculated at once."],
      ["Can I self-host it?", "Yes. The code is open source under AGPL-3.0 on GitHub. A VDS with 2 cores and 2 GB of RAM is enough."],
    ],
  },
  diy: { title: "Open source", text: "The project is open under AGPL-3.0: server, dashboard, TV screen and firmware for ESP8266/ESP32 with signed updates. The inverter protocol is documented. Repository:", repo: "deye-dashboard on GitHub" },
  foot: { contact: "Contact", made: "Made in Ukraine 🇺🇦" },
};

export const CONTENT: Record<Lang, LandingContent> = { uk, en };
