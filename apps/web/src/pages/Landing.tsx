import { Link } from "wouter";
import type { Me } from "../api.ts";
import { PRODUCT_NAME } from "@deye/shared";
import { track } from "../analytics.ts";
import { Logo } from "../components/Logo.tsx";

const cta = (place: string) => () => track("cta_click", { place });

export const FAQ: [string, string][] = [
  ["Які інвертори підтримуються?", "Гібридні інвертори Deye: однофазні SG0xLP1, трифазні низьковольтні SG04LP3 і високовольтні SG01HP3. Дані читаються через Wi-Fi-стік Solarman, який уже є в інверторі. Інші бренди підключаємо за запитом у тарифі Max."],
  ["Чи потрібно купувати додаткове обладнання?", "Ні. Достатньо телевізора з браузером і Wi-Fi-стіка інвертора. Плату ESP можна поставити за бажанням, прошивка відкрита."],
  ["Чи продовжить працювати застосунок Solarman?", "Так. У стіку задається другий сервер, перший лишається без змін, тож Solarman оновлюється як і раніше."],
  ["Що бачить персонал під час відключення світла?", "Червоний банер «світла немає з 14:20», залишок батареї у відсотках і прогноз «вистачить ≈ 3 год 20 хв при поточному споживанні». Увімкнули гриль — прогноз перерахувався одразу."],
  ["Які телевізори підходять?", "Будь-який Smart TV з браузером: Samsung, LG, Android TV, або приставка. На телевізорі відкриваєте tv.sun-hunter.men/tv і вводите шестизначний код із кабінету."],
  ["Скільки це коштує?", "Тариф Free безкоштовний назавжди і має весь функціонал: один телевізор і один логер, усі віджети, власні відеофони й фото, радіо, історія за рік. Pro — 600 ₴ на місяць: те саме на 5 телевізорів і 5 логерів, без брендингу на екрані. Оплата карткою через monobank."],
];

const CONTACT = "mailto:onkofe227@gmail.com";
/** Плитки на 2 колонки, щоб bento-сітка 3×4 закривалась без дірок (велика 2 + 8 малих + 2 широкі = 12). */
const WIDE = new Set(["Повітряна тривога", "Погода і сонце на завтра"]);

export function Landing({ me }: { me: Me | null }) {
  return <div className="land">
    <div className="land-bg" aria-hidden="true" />
    <header className="land-top">
      <Link href="/" className="brand"><Logo />{PRODUCT_NAME}</Link>
      <nav>
        <a href="#outage">Відключення</a><a href="#how">Як це працює</a><a href="#features">Можливості</a><a href="#pricing">Тарифи</a><a href="#faq">Питання</a>
        {me ? <Link href="/app" className="btn btn-primary">Кабінет</Link> : <><Link href="/login" className="btn btn-ghost">Увійти</Link><Link href="/signup" className="btn btn-primary" onClick={cta("header")}>Спробувати безкоштовно</Link></>}
      </nav>
    </header>

    <section className="hero">
      <div className="hero-text">
        <span className="eyebrow"><i />Працює з Deye · Solarman-стік · без додаткового обладнання</span>
        <h1>Ваша сонячна станція наживо на <em>телевізорі в залі</em></h1>
        <p>Один екран у залі кафе, магазину чи офісу замість дзвінків власнику: під час відключень світла персонал сам бачить залишок батареї і скільки годин заклад протримається. Гості бачать, що кава зварена на сонці. Плюс меню, погода, повітряна тривога, радіо і QR-коди. Працює з інверторами Deye через Solarman-стік без додаткового обладнання; інші бренди — за запитом.</p>
        <div className="hero-cta">
          <Link href="/signup" className="btn btn-primary big" onClick={cta("hero")}>Підключити заклад</Link>
          <a href="#how" className="btn big">Як це працює</a>
        </div>
        <p className="hero-notes"><span>Безкоштовний тариф назавжди</span><span>Налаштування 10 хвилин</span></p>
      </div>
      <div className="hero-shot">
        <div className="orbit" aria-hidden="true" />
        <div className="tvframe">
          <div className="tvbar"><span>SunHunter TV · Зал</span><span className="mono"><i className="live" />LIVE · оновлення 10 с</span></div>
          {/* запис реального екрана; постер і <img> лишаються для пошуковиків і для режиму без анімації */}
          <video className="hero-video" autoPlay muted loop playsInline preload="metadata" poster="/landing/screen.jpg" width={1280} height={720}
            aria-label="Екран SunHunter TV на телевізорі в кафе: відеофон, показники сонячної станції Deye, заряд батареї, меню закладу, тривога">
            <source src="/landing/hero.webm" type="video/webm" />
            <source src="/landing/hero.mp4" type="video/mp4" />
          </video>
          <img className="hero-img" src="/landing/screen.jpg" width={1280} height={720} alt="Екран SunHunter TV на телевізорі в кафе: відеофон з каміном, показники сонячної станції Deye, заряд батареї, меню закладу" />
        </div>
        <span className="hchip hchip-a"><b>🔋 64 %</b> вистачить ≈ 6 год</span>
        <span className="hchip hchip-b"><b>🛡</b> Тривога: спокійно</span>
        <span className="hchip hchip-c"><b>🌱</b> CO₂ −120 кг за місяць</span>
        <a className="hero-live" href="/s/7ksxpmqDtpPBasCOB0xm-ydyqo1DvdywJZS2SSy-tN8" target="_blank" rel="noreferrer" onClick={cta("hero_live")}>▶ Подивитись наживо</a>
      </div>
    </section>

    <section id="outage" className="land-sec outage-sec">
      <span className="kicker kicker-red">Автономність і спокій</span>
      <h2>Коли вимкнули світло</h2>
      <p className="lead">Власнику більше не дзвонять із питанням «скільки ще протримаємось». Екран відповідає сам.</p>
      <div className="steps">
        <div className="step"><span className="n n-red">⚡</span><h3>Мережі немає — екран покаже одразу</h3><p>Віджет мережі стає червоним: «світло вимкнено, працюємо від батареї». Персонал бачить це з бару, не заходячи в застосунки.</p></div>
        <div className="step"><span className="n n-amber">🔋</span><h3>Скільки годин лишилось</h3><p>Залишок батареї і прогноз «≈ 3 год 20 хв при поточному споживанні». Впав нижче 40% — жовтий, наближається до мінімуму — червоний.</p></div>
        <div className="step"><span className="n n-cyan">🍳</span><h3>Що можна вмикати</h3><p>Споживання наживо: увімкнули гриль чи бойлер — цифра і прогноз змінились тут же. Персонал сам вирішує, що відкласти до світла.</p></div>
      </div>
    </section>

    <section id="how" className="land-sec">
      <span className="kicker">Швидкий старт</span>
      <h2>Як це працює</h2>
      <div className="steps how">
        <div className="step"><span className="num">01</span><h3>Стік дивиться на наш сервер</h3><p>На прихованій сторінці Solarman-стіка вписуєте три поля. Застосунок Solarman продовжує працювати як раніше.</p></div>
        <div className="step"><span className="num">02</span><h3>Збираєте екран у кабінеті</h3><p>Обираєте відеофон, розставляєте віджети, додаєте меню, радіо і QR. Зміни зʼявляються на телевізорі одразу.</p></div>
        <div className="step"><span className="num">03</span><h3>Телевізор відкриває tv.sun-hunter.men/tv</h3><p>Вводите 6-значний код із кабінету. Далі телевізор памʼятає екран сам, навіть після вимкнення.</p></div>
      </div>
    </section>

    <section id="features" className="land-sec">
      <span className="kicker">Можливості та віджети</span>
      <h2>Що на екрані</h2>
      <div className="feats">
        <div className="feat feat-big">
          <span className="tag">Головний модуль</span>
          <h3>Показники наживо</h3>
          <p>Сонце, батарея, мережа, споживання і підсумок дня. Оновлення кожні 10 секунд, чесна позначка, якщо дані застаріли.</p>
          <div className="stats"><span><small>Сонце</small><b className="c-amber">4.2 kW</b></span><span><small>Батарея</small><b className="c-cyan">64 %</b></span><span><small>Споживання</small><b>1.8 kW</b></span></div>
        </div>
        {[
          ["🎞", "Відеофони", "Камін, водоспад, акваріум, дощ за вікном: понад 30 кліпів з ліцензією для закладів, або власні відео та фото."],
          ["📻", "Онлайн-радіо", "14 українських станцій одним кліком у кабінеті, перемикання без перезавантаження телевізора."],
          ["🧾", "Меню закладу", "Багаторядкове меню з розділами і цінами, шрифти й кольори на вибір. Оновили в кабінеті — оновилось на ТБ."],
          ["📈", "Графіки", "Крива генерації і споживання за добу на екрані, історія за рік у кабінеті."],
          ["🔲", "QR-коди", "Wi-Fi для гостей одним сканом, меню, Instagram чи відгуки. Просто вставте посилання або пароль."],
          ["🚨", "Повітряна тривога", "Стан вашої області на екрані і банер на весь телевізор під час тривоги. Без ключів і налаштувань, лише виберіть область."],
          ["🌤", "Погода і сонце на завтра", "Температура, вітер, захід сонця і прогноз генерації на завтра у кВт·год для вашої станції."],
          ["🌱", "Еко-статистика", "Скільки кВт·год від сонця за місяць і скільки CO₂ не потрапило в повітря. Аргумент для гостей і для соцмереж."],
        ].map(([i, h, p]) => <div key={h} className={`feat${WIDE.has(h!) ? " feat-wide" : ""}`}><div className="ico">{i}</div><h3>{h}</h3><p>{p}</p></div>)}
      </div>
    </section>

    <section id="pricing" className="land-sec">
      <span className="kicker">Прозорі тарифи</span>
      <h2>Тарифи</h2>
      <div className="plans plans-3">
        <div className="plan">
          <h3>Free</h3><div className="price">0 ₴<span className="per"> / назавжди</span></div>
          <ul><li>1 телевізор і 1 логер</li><li>Увесь функціонал: усі віджети, власні відеофони й фото, радіо</li><li>Історія та графіки за рік</li><li>Невеликий напис {PRODUCT_NAME} і плашка з QR раз на 10 хвилин</li></ul>
          <Link href="/signup" className="btn" onClick={cta("pricing_free")}>Почати</Link>
        </div>
        <div className="plan pro">
          <span className="badge">Найпопулярніший</span>
          <h3>Pro</h3><div className="price">600 ₴<span className="per"> / міс</span></div>
          <p className="muted small mono">Пів року — 3000 ₴ (місяць у подарунок), рік — 6000 ₴ (два місяці у подарунок)</p>
          <ul><li>До 5 телевізорів і 5 логерів</li><li>Увесь функціонал, як у Free</li><li>Без брендингу на екрані</li><li>Пріоритетна підтримка</li></ul>
          <Link href="/signup" className="btn btn-primary" onClick={cta("pricing_pro")}>Підключити Pro</Link>
          <p className="muted small" style={{ marginTop: ".5rem" }}>Оплата карткою в кабінеті через monobank</p>
        </div>
        <div className="plan">
          <h3>Max</h3><div className="price">за домовленістю</div>
          <ul><li>Мережа закладів: до 50 телевізорів і логерів</li><li>Інші бренди інверторів</li><li>Персональні віджети й брендування</li><li>Пріоритетна підтримка</li></ul>
          <a href={CONTACT} className="btn" onClick={cta("pricing_max")}>Обговорити</a>
        </div>
      </div>
    </section>

    <section id="faq" className="land-sec">
      <span className="kicker">Часті запитання</span>
      <h2>Все, що треба знати перед підключенням</h2>
      <div className="faq">
        {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
      </div>
    </section>

    <section className="land-sec diy">
      <h2>Для інсталяторів і DIY</h2>
      <p className="muted">Протокол відкритий: стік напряму, або власний пристрій на ESP8266/ESP32 із відкритою прошивкою, самореєстрацією і підписаними оновленнями. Документація в репозиторії <a href="https://github.com/andreyyaremenko-ops/deye-dashboard" target="_blank" rel="noreferrer">deye-dashboard</a>.</p>
    </section>

    <footer className="land-foot">
      <span className="brand"><Logo />{PRODUCT_NAME}</span>
      <span className="mono">© {new Date().getFullYear()} · tv.sun-hunter.men</span>
      <span className="grow" />
      <a href={CONTACT}>Контакт</a>
      <a href="https://github.com/andreyyaremenko-ops/deye-dashboard" target="_blank" rel="noreferrer">GitHub</a>
      <span className="mono">Зроблено в Україні 🇺🇦</span>
    </footer>
  </div>;
}
