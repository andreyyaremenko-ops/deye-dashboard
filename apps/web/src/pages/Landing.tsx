import { Link } from "wouter";
import type { Me } from "../api.ts";

const CONTACT = "mailto:onkofe227@gmail.com";

export function Landing({ me }: { me: Me | null }) {
  return <div className="land">
    <header className="land-top">
      <div className="brand">☀ Deye Dashboard</div>
      <nav>
        <a href="#how">Як це працює</a><a href="#features">Можливості</a><a href="#pricing">Тарифи</a>
        {me ? <Link href="/app" className="btn btn-primary">Кабінет</Link> : <><Link href="/login" className="btn btn-ghost">Увійти</Link><Link href="/signup" className="btn btn-primary">Спробувати безкоштовно</Link></>}
      </nav>
    </header>

    <section className="hero">
      <div className="hero-text">
        <h1>Ваша сонячна станція наживо на телевізорі в залі</h1>
        <p>Гості бачать, що кава зварена на сонці: генерація, батарея, споживання поверх спокійного відеофону. Плюс меню закладу, радіо і QR-коди. Працює з інверторами Deye через Solarman-стік, без додаткового обладнання.</p>
        <div className="hero-cta">
          <Link href="/signup" className="btn btn-primary big">Підключити заклад</Link>
          <a href="#how" className="btn big">Як це працює</a>
        </div>
        <p className="muted small">Безкоштовний тариф назавжди. Налаштування займає 10 хвилин.</p>
      </div>
      <div className="hero-shot"><img src="/landing/screen.jpg" alt="Екран на телевізорі: камін, показники станції, меню" /></div>
    </section>

    <section id="how" className="land-sec">
      <h2>Як це працює</h2>
      <div className="steps">
        <div className="step"><span className="n">1</span><h3>Стік дивиться на наш сервер</h3><p>На прихованій сторінці Solarman-стіка вписуєте три поля. Застосунок Solarman продовжує працювати як раніше.</p></div>
        <div className="step"><span className="n">2</span><h3>Збираєте екран у кабінеті</h3><p>Обираєте відеофон, розставляєте віджети, додаєте меню, радіо і QR. Зміни зʼявляються на телевізорі одразу.</p></div>
        <div className="step"><span className="n">3</span><h3>Телевізор відкриває tv.sun-hunter.men/tv</h3><p>Вводите 6-значний код із кабінету. Далі телевізор памʼятає екран сам, навіть після вимкнення.</p></div>
      </div>
    </section>

    <section id="features" className="land-sec">
      <h2>Що на екрані</h2>
      <div className="feats">
        {[
          ["☀", "Показники наживо", "Сонце, батарея, мережа, споживання і підсумок дня. Оновлення кожні 10 секунд, чесна позначка, якщо дані застаріли."],
          ["🎞", "Відеофони", "Камін, водоспад, акваріум, дощ за вікном: понад 30 кліпів з ліцензією для закладів. У Pro — власні відео."],
          ["📻", "Онлайн-радіо", "14 українських станцій одним кліком у кабінеті, перемикання без перезавантаження телевізора."],
          ["🧾", "Меню закладу", "Багаторядкове меню з розділами і цінами, великий читабельний шрифт. Оновили в кабінеті — оновилось на ТБ."],
          ["📈", "Графіки", "Крива генерації і споживання за добу на екрані, історія за рік у кабінеті (Pro)."],
          ["🔲", "QR-коди", "На меню, Wi-Fi, Instagram чи відгуки. Просто вставте посилання."],
        ].map(([i, h, p]) => <div key={h} className="feat"><div className="ico">{i}</div><h3>{h}</h3><p>{p}</p></div>)}
      </div>
    </section>

    <section id="pricing" className="land-sec">
      <h2>Тарифи</h2>
      <div className="plans">
        <div className="plan">
          <h3>Free</h3><div className="price">0 ₴</div>
          <ul><li>1 екран</li><li>Стандартні відеофони</li><li>Усі віджети показників, меню, QR</li><li>Невеликий напис «powered by» і плашка з QR раз на 10 хвилин</li></ul>
          <Link href="/signup" className="btn">Почати</Link>
        </div>
        <div className="plan pro">
          <h3>Pro</h3><div className="price">за запитом</div>
          <ul><li>До 5 екранів</li><li>Власні відеофони</li><li>Онлайн-радіо</li><li>Історія та графіки за рік</li><li>Без брендингу</li></ul>
          <a href={CONTACT} className="btn btn-primary">Написати нам</a>
        </div>
      </div>
    </section>

    <section className="land-sec">
      <h2>Для інсталяторів і DIY</h2>
      <p className="muted">Протокол відкритий: стік напряму, або власний пристрій на ESP8266/ESP32 із відкритою прошивкою, самореєстрацією і підписаними оновленнями. Документація в репозиторії <a href="https://github.com/andreyyaremenko-ops/deye-dashboard" target="_blank" rel="noreferrer">deye-dashboard</a>.</p>
    </section>

    <footer className="land-foot">
      <span>© {new Date().getFullYear()} Deye Dashboard · tv.sun-hunter.men</span>
      <a href={CONTACT}>Контакт</a>
    </footer>
  </div>;
}
