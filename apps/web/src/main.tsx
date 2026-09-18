import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./styles.css";
import "./fonts.css";

import { isPublicPath } from "./seo.ts";

// Лендінг пререндерений (prerender.tsx): "/" у dist/index.html, "/en" у dist/en/index.html — там гідруємо готову розмітку.
// "/landing" віддає українську розмітку, тож теж гідрується; решта шляхів рендериться з нуля.
const root = document.getElementById("root")!;
if (root.firstElementChild && isPublicPath(location.pathname)) hydrateRoot(root, <App />);
else createRoot(root).render(<App />);
