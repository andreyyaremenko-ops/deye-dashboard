/** Лендінг: перш за все електронне меню / digital signage, сонячна станція — додаток. Тексти двома мовами в landing/content.ts. */
import { Link } from "wouter";
import type { Me } from "../api.ts";
import { PRODUCT_NAME } from "@deye/shared";
import { track } from "../analytics.ts";
import { Logo } from "../components/Logo.tsx";
import { CONTENT, pathOf, type Lang } from "../landing/content.ts";

const cta = (place: string) => () => track("cta_click", { place });
const CONTACT = "mailto:onkofe227@gmail.com";
const REPO = "https://github.com/andreyyaremenko-ops/deye-dashboard";
const DEMO = "/s/7ksxpmqDtpPBasCOB0xm-ydyqo1DvdywJZS2SSy-tN8";
const CHIP_POS = ["hchip-a", "hchip-b", "hchip-c"];
const ICON_TONE = ["n-red", "n-amber", "n-cyan"];

export function Landing({ me, lang = "uk" }: { me: Me | null; lang?: Lang }) {
  const t = CONTENT[lang];
  const other: Lang = lang === "uk" ? "en" : "uk";
  return <div className="land" lang={t.htmlLang}>
    <div className="land-bg" aria-hidden="true" />
    <header className="land-top">
      <Link href={pathOf(lang)} className="brand"><Logo />{PRODUCT_NAME}</Link>
      <nav>
        <a href="#signage">{t.nav.signage}</a><a href="#how">{t.nav.how}</a><a href="#features">{t.nav.features}</a><a href="#energy">{t.nav.energy}</a><a href="#pricing">{t.nav.pricing}</a><a href="#faq">{t.nav.faq}</a>
        {/* повне перезавантаження: інша мова — окремий пререндерений документ зі своїм <head> */}
        <a href={pathOf(other)} hrefLang={other} className="lang-switch" onClick={cta(`lang_${other}`)}>{t.nav.otherLang}</a>
        {me ? <Link href="/app" className="btn btn-primary">{t.nav.cabinet}</Link> : <><Link href="/login" className="btn btn-ghost">{t.nav.login}</Link><Link href="/signup" className="btn btn-primary" onClick={cta("header")}>{t.nav.tryFree}</Link></>}
      </nav>
    </header>

    <section className="hero">
      <div className="hero-text">
        <span className="eyebrow"><i />{t.hero.eyebrow}</span>
        <h1>{t.hero.h1a} <em>{t.hero.h1em}</em></h1>
        <p>{t.hero.lead}</p>
        <div className="hero-cta">
          <Link href="/signup" className="btn btn-primary big" onClick={cta("hero")}>{t.hero.cta}</Link>
          <a href="#how" className="btn big">{t.hero.how}</a>
        </div>
        <p className="hero-notes">{t.hero.notes.map((n) => <span key={n}>{n}</span>)}</p>
      </div>
      <div className="hero-shot">
        <div className="orbit" aria-hidden="true" />
        <div className="tvframe">
          <div className="tvbar"><span>{t.hero.tvBar}</span><span className="mono"><i className="live" />{t.hero.live}</span></div>
          {/* запис реального екрана; постер і <img> лишаються для пошуковиків і для режиму без анімації */}
          <video className="hero-video" autoPlay muted loop playsInline preload="metadata" poster="/landing/screen.jpg" width={1280} height={720} aria-label={t.hero.videoAlt}>
            <source src="/landing/hero.webm" type="video/webm" />
            <source src="/landing/hero.mp4" type="video/mp4" />
          </video>
          <img className="hero-img" src="/landing/screen.jpg" width={1280} height={720} alt={t.hero.imgAlt} />
        </div>
        {t.hero.chips.map(([i, text], k) => <span key={text} className={`hchip ${CHIP_POS[k]}`}><b>{i}</b> {text}</span>)}
        <a className="hero-live" href={DEMO} target="_blank" rel="noreferrer" onClick={cta("hero_live")}>{t.hero.watchLive}</a>
      </div>
    </section>

    <section id="signage" className="land-sec">
      <span className="kicker">{t.signage.kicker}</span>
      <h2>{t.signage.title}</h2>
      <p className="lead">{t.signage.lead}</p>
      <div className="steps">
        {t.signage.cards.map(([i, h, p]) => <div key={h} className="step"><span className="n">{i}</span><h3>{h}</h3><p>{p}</p></div>)}
      </div>
    </section>

    <section id="how" className="land-sec">
      <span className="kicker">{t.how.kicker}</span>
      <h2>{t.how.title}</h2>
      <div className="steps how">
        {t.how.steps.map(([h, p], i) => <div key={h} className="step"><span className="num">0{i + 1}</span><h3>{h}</h3><p>{p}</p></div>)}
      </div>
    </section>

    <section id="features" className="land-sec">
      <span className="kicker">{t.features.kicker}</span>
      <h2>{t.features.title}</h2>
      <div className="feats">
        <div className="feat feat-big">
          <span className="tag">{t.features.bigTag}</span>
          <h3>{t.features.bigTitle}</h3>
          <p>{t.features.bigText}</p>
          <div className="stats">{t.features.stats.map(([k, v], i) => <span key={k}><small>{k}</small><b className={i === 0 ? "c-amber" : i === 1 ? "c-cyan" : ""}>{v}</b></span>)}</div>
        </div>
        {t.features.cards.map(([i, h, p]) => <div key={h} className={`feat${t.features.wide.includes(h) ? " feat-wide" : ""}`}><div className="ico">{i}</div><h3>{h}</h3><p>{p}</p></div>)}
      </div>
    </section>

    <section id="energy" className="land-sec outage-sec">
      <span className="kicker kicker-red">{t.energy.kicker}</span>
      <h2>{t.energy.title}</h2>
      <p className="lead">{t.energy.lead}</p>
      <div className="steps">
        {t.energy.cards.map(([i, h, p], k) => <div key={h} className="step"><span className={`n ${ICON_TONE[k]}`}>{i}</span><h3>{h}</h3><p>{p}</p></div>)}
      </div>
    </section>

    <section id="pricing" className="land-sec">
      <span className="kicker">{t.pricing.kicker}</span>
      <h2>{t.pricing.title}</h2>
      <p className="lead">{t.pricing.lead}</p>
      <div className="plans plans-3">
        <div className="plan">
          <h3>Free</h3><div className="price">0 ₴<span className="per">{t.pricing.forever}</span></div>
          <ul>{t.pricing.free.map((x) => <li key={x}>{x}</li>)}</ul>
          <Link href="/signup" className="btn" onClick={cta("pricing_free")}>{t.pricing.start}</Link>
        </div>
        <div className="plan pro">
          <span className="badge">{t.pricing.badge}</span>
          <h3>Pro</h3><div className="price">600 ₴<span className="per">{t.pricing.perMonth}</span></div>
          <p className="muted small mono">{t.pricing.proNote}</p>
          <ul>{t.pricing.pro.map((x) => <li key={x}>{x}</li>)}</ul>
          <Link href="/signup" className="btn btn-primary" onClick={cta("pricing_pro")}>{t.pricing.goPro}</Link>
          <p className="muted small" style={{ marginTop: ".5rem" }}>{t.pricing.payNote}</p>
        </div>
        <div className="plan">
          <h3>Max</h3><div className="price">{t.pricing.onRequest}</div>
          <ul>{t.pricing.max.map((x) => <li key={x}>{x}</li>)}</ul>
          <a href={CONTACT} className="btn" onClick={cta("pricing_max")}>{t.pricing.discuss}</a>
        </div>
      </div>
    </section>

    <section id="faq" className="land-sec">
      <span className="kicker">{t.faq.kicker}</span>
      <h2>{t.faq.title}</h2>
      <div className="faq">
        {t.faq.items.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
      </div>
    </section>

    <section className="land-sec diy">
      <h2>{t.diy.title}</h2>
      <p className="muted">{t.diy.text} <a href={REPO} target="_blank" rel="noreferrer">{t.diy.repo}</a>.</p>
    </section>

    <footer className="land-foot">
      <span className="brand"><Logo />{PRODUCT_NAME}</span>
      <span className="mono">© {new Date().getFullYear()} · tv.sun-hunter.men</span>
      <span className="grow" />
      <a href={CONTACT}>{t.foot.contact}</a>
      <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
      <a href={pathOf(other)} hrefLang={other}>{t.nav.otherLang}</a>
      <span className="mono">{t.foot.made}</span>
    </footer>
  </div>;
}
