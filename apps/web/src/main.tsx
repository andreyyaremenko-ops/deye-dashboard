import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./styles.css";

// Лендінг пререндерений у dist/index.html (prerender.tsx): на "/" гідруємо готову розмітку, інакше рендеримо з нуля
const root = document.getElementById("root")!;
if (root.firstElementChild && location.pathname === "/") hydrateRoot(root, <App />);
else createRoot(root).render(<App />);
