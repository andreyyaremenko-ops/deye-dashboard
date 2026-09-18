/**
 * Пререндер лендінгу для пошуковиків: `vite build --ssr scripts/prerender.tsx` -> node dist-ssr/prerender.js.
 * Для кожної мови пише окремий документ (dist/index.html, dist/en/index.html): розмітка лендінгу в #root і повний
 * SEO-блок <head> з landing/content.ts — title, description, canonical, hreflang, Open Graph, JSON-LD з FAQ.
 * Також генерує dist/sitemap.xml з датою збірки. Клієнт гідрує (main.tsx).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import { Landing } from "../src/pages/Landing.tsx";
import { CONTENT, LANGS, SITE, pathOf, type Lang } from "../src/landing/content.ts";

const dist = new URL("../dist/", import.meta.url);
const template = readFileSync(new URL("index.html", dist), "utf8");
const START = "<!--seo:start-->", END = "<!--seo:end-->";
if (!template.includes('<div id="root"></div>') || !template.includes(START) || !template.includes(END)) throw new Error("dist/index.html: #root or seo markers not found (already prerendered?)");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const urlOf = (lang: Lang) => SITE + pathOf(lang);
const OG_IMAGE = `${SITE}/landing/og.jpg`;

function head(lang: Lang): string {
  const t = CONTENT[lang], url = urlOf(lang);
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "Organization", "@id": `${SITE}/#org`, name: "SunHunter TV", url: `${SITE}/`, logo: OG_IMAGE, areaServed: "UA", sameAs: ["https://github.com/andreyyaremenko-ops/deye-dashboard"] },
    { "@type": "WebSite", "@id": `${url}#site`, url, name: "SunHunter TV", inLanguage: t.htmlLang, publisher: { "@id": `${SITE}/#org` } },
    { "@type": "SoftwareApplication", name: "SunHunter TV", applicationCategory: "BusinessApplication", applicationSubCategory: "Digital signage", operatingSystem: "Web, Smart TV", url, image: OG_IMAGE, inLanguage: t.htmlLang,
      description: t.meta.appDescription,
      offers: [
        { "@type": "Offer", name: "Free", price: "0", priceCurrency: "UAH", url: `${url}#pricing` },
        { "@type": "Offer", name: "Pro", price: "600", priceCurrency: "UAH", url: `${url}#pricing`, priceSpecification: { "@type": "UnitPriceSpecification", price: "600", priceCurrency: "UAH", billingDuration: "P1M" } },
      ] },
    { "@type": "FAQPage", inLanguage: t.htmlLang, mainEntity: t.faq.items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ] };
  return [
    `<title>${esc(t.meta.title)}</title>`,
    `<meta name="description" content="${esc(t.meta.description)}">`,
    `<link rel="canonical" href="${url}">`,
    ...LANGS.map((l) => `<link rel="alternate" hreflang="${CONTENT[l].htmlLang}" href="${urlOf(l)}">`),
    `<link rel="alternate" hreflang="x-default" href="${urlOf("uk")}">`,
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="SunHunter TV">`,
    `<meta property="og:locale" content="${t.ogLocale}">`, `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${esc(t.meta.ogTitle)}">`, `<meta property="og:description" content="${esc(t.meta.ogDescription)}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:title" content="${esc(t.meta.ogTitle)}">`,
    `<meta name="twitter:description" content="${esc(t.meta.ogDescription)}">`, `<meta name="twitter:image" content="${OG_IMAGE}">`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  ].join("\n  ");
}

for (const lang of LANGS) {
  const body = renderToString(<Router ssrPath={pathOf(lang)}><Landing me={null} lang={lang} /></Router>);
  let html = template.replace(/<html lang="[^"]*">/, `<html lang="${CONTENT[lang].htmlLang}">`);
  html = html.slice(0, html.indexOf(START)) + head(lang) + html.slice(html.indexOf(END) + END.length);
  // підтвердження Search Console мета-тегом: без значення тег не потрібен (підтверджено файлом)
  html = html.replace(/\s*<meta name="google-site-verification" content="(%[^"]*%)?">/, "");
  html = html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  const out = lang === "uk" ? new URL("index.html", dist) : new URL(`${lang}/index.html`, dist);
  mkdirSync(new URL(".", out), { recursive: true });
  writeFileSync(out, html);
  console.log(`prerendered landing [${lang}]: ${body.length} bytes -> ${out.pathname.replace(dist.pathname, "dist/")}`);
}

const today = new Date().toISOString().slice(0, 10);
const alternates = LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${CONTENT[l].htmlLang}" href="${urlOf(l)}"/>`).join("");
writeFileSync(new URL("sitemap.xml", dist), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LANGS.map((l) => `  <url><loc>${urlOf(l)}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>${l === "uk" ? "1.0" : "0.9"}</priority>${alternates}</url>`).join("\n")}
</urlset>
`);
console.log(`sitemap.xml: ${LANGS.length} urls, lastmod ${today}`);
