/**
 * Віджет «Неонова вивіска» (neon_sign): назва закладу світними трубками на стіні. Розмір шрифту підганяється
 * під віджет (міряємо при 100px і масштабуємо), тож вивіска на окремій сцені 100×100 займає весь екран.
 * Сяйво — text-shadow від currentColor; мерехтіння — лише opacity, на слабких ТБ (.lite) вимикається.
 */
import { useLayoutEffect, useRef } from "preact/hooks";
import { neonSignStyle } from "@deye/shared/menu";

/** Літера, що «барахлить»: ближче до кінця першого рядка, не пробіл і не розділовий знак. */
function badIndex(line: string): number {
  for (let i = Math.floor(line.length * 0.6); i < line.length; i++) if (!/[\s.,:;!?«»"'()\-–—]/.test(line[i]!)) return i;   // без \p{L}: старі ТБ-браузери його не знають
  return -1;
}

export function NeonSign({ cls, props }: { cls: string; props: Record<string, unknown> }) {
  const st = neonSignStyle(props);
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const key = `${st.lines.join("\n")}|${st.sub}|${st.fontFamily}|${st.frame}`;

  useLayoutEffect(() => {
    let alive = true;
    const fit = () => {
      const b = box.current, i = inner.current;
      if (!alive || !b || !i) return;
      i.style.fontSize = "100px";
      const k = Math.min((b.clientWidth * 0.84) / Math.max(1, i.offsetWidth), (b.clientHeight * 0.78) / Math.max(1, i.offsetHeight));
      i.style.fontSize = `${Math.max(8, Math.floor(100 * k))}px`;
    };
    fit();
    // шрифт вантажиться пізніше за перший рендер — після нього ширина інша
    void (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(fit);
    window.addEventListener("resize", fit);
    return () => { alive = false; window.removeEventListener("resize", fit); };
  }, [key]);

  const bad = st.flicker === "broken" ? badIndex(st.lines[0]!) : -1;
  return <div ref={box} class={`${cls} neon-sign nf-${st.flicker}${st.surface ? ` surf-${st.surface}` : " neon-bare"}`}>
    <div ref={inner} class={`ns-in${st.frame ? " ns-frame" : ""}`} style={{ color: st.color }}>
      {st.lines.map((l, n) => <div key={n} class="ns-line" style={{ fontFamily: st.fontFamily }}>
        {n === 0 && bad >= 0 ? <>{l.slice(0, bad)}<span class="ns-bad">{l[bad]}</span>{l.slice(bad + 1)}</> : l}
      </div>)}
      {st.sub && <div class="ns-sub" style={{ color: st.subColor }}>{st.sub}</div>}
    </div>
  </div>;
}
