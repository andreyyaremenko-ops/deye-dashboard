/** QR-віджет: довільне посилання (меню, Wi-Fi, Instagram) + підпис. */
import { useMemo } from "preact/hooks";
import qrcode from "qrcode-generator";

export function QrWidget({ cls, props }: { cls: string; props: Record<string, unknown> }) {
  const url = String(props.url ?? "https://tv.sun-hunter.men/?utm_source=tv").trim();
  const caption = String(props.caption ?? "").trim();
  const svg = useMemo(() => {
    try { const q = qrcode(0, "M"); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
    catch { return ""; }
  }, [url]);
  return <div class={`${cls} w-qr${props.card === false ? " menu-plain" : ""}`}>
    <div class="qr-box" dangerouslySetInnerHTML={{ __html: svg }} />
    {caption && <div class="qr-cap">{caption}</div>}
  </div>;
}
