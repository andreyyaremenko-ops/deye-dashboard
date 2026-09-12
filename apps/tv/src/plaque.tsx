/**
 * Безкоштовний тариф: раз на 10 хв на 12 с зʼявляється плашка з QR на сайт.
 * Перший показ через 2 хв після старту.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import qrcode from "qrcode-generator";

const SITE = "https://tv.sun-hunter.men";
const EVERY_MS = 10 * 60_000, SHOW_MS = 12_000, FIRST_MS = 2 * 60_000;

export function Plaque() {
  const [on, setOn] = useState(false);
  const svg = useMemo(() => { const q = qrcode(0, "M"); q.addData(`${SITE}/?utm_source=tv`); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }, []);
  useEffect(() => {
    let hide: number | undefined;
    const show = () => { setOn(true); hide = window.setTimeout(() => setOn(false), SHOW_MS); };
    const first = window.setTimeout(() => { show(); }, FIRST_MS);
    const every = window.setInterval(show, EVERY_MS);
    return () => { clearTimeout(first); clearInterval(every); clearTimeout(hide); };
  }, []);
  if (!on) return null;
  return <div class="plaque">
    <div class="plaque-qr" dangerouslySetInnerHTML={{ __html: svg }} />
    <div><b>Такий екран для вашого закладу</b><div class="sub">tv.sun-hunter.men · сонячна станція наживо на ТБ</div></div>
  </div>;
}
