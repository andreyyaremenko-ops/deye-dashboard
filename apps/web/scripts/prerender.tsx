/**
 * Пререндер лендінгу для пошуковиків: `vite build --ssr src/prerender.tsx` -> node dist-ssr/prerender.js
 * вставляє HTML лендінгу в dist/index.html. Клієнт гідрує (main.tsx).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import { Landing } from "../src/pages/Landing.tsx";

const file = new URL("../dist/index.html", import.meta.url);
const html = readFileSync(file, "utf8");
const body = renderToString(<Router ssrPath="/"><Landing me={null} /></Router>);
if (!html.includes('<div id="root"></div>')) throw new Error("dist/index.html: #root not found or already prerendered");
writeFileSync(file, html.replace('<div id="root"></div>', `<div id="root">${body}</div>`));
console.log(`prerendered landing: ${body.length} bytes`);
