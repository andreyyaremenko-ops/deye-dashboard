/** Віджет «Вебсторінка» (web): чужа сторінка у фреймі, напр. окрема сцена 100×100. Лише http(s) або шлях цього домену (/ext/… — проксі Caddy). */
import { useEffect, useState } from "preact/hooks";

const safeUrl = (u: string) => (/^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u) ? u : null);

export function WebWidget({ cls, props }: { cls: string; props: Record<string, unknown> }) {
  const url = safeUrl(String(props.url ?? "").trim());
  const refreshMin = Number(props.refreshMin ?? 0);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url || !(refreshMin > 0)) return;
    const t = setInterval(() => setN((x) => x + 1), refreshMin * 60_000);
    return () => clearInterval(t);
  }, [url, refreshMin]);
  if (!url) return <div class={cls}><div class="text">Вкажіть адресу сторінки</div></div>;
  // key змінюється — фрейм створюється заново, тобто сторінка перезавантажується
  return <div class={cls}><iframe key={n} src={url} scrolling="no" referrerpolicy="no-referrer" /></div>;
}
