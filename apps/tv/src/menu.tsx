/**
 * Віджет «Меню закладу»: сітка страв поверх атмосферного фону.
 * Назви, ціни й обʼєми — живий текст із БД (оновлюються по WS разом із конфігом),
 * фото — з /media, Ken Burns чистим CSS. Розділи змінюються слайдами.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import { menuStyle } from "@deye/shared/menu";
import { formatPrice, type MenuPayload, type MenuSectionPayload } from "@deye/shared/menu-data";

interface Props {
  cls: string;
  menu: MenuPayload | null | undefined;
  props: Record<string, unknown>;
  theme: "dark" | "light";
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function MenuWidget({ cls, menu, props, theme }: Props) {
  // позиції «закінчилось»: або ховаємо, або показуємо перекресленими
  const hideOut = props.outOfStock !== "strike";
  const withPhotos = props.photos !== false;
  const sections = useMemo<MenuSectionPayload[]>(() => (menu?.sections ?? [])
    .map((s) => ({ ...s, items: hideOut ? s.items.filter((i) => i.inStock) : s.items }))
    .filter((s) => s.items.length), [menu, hideOut]);

  const [idx, setIdx] = useState(0);
  const seconds = clamp(Number(props.sectionS ?? 15) || 15, 5, 300);
  useEffect(() => { setIdx(0); }, [menu?.id]);
  useEffect(() => {
    if (sections.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % sections.length), seconds * 1000);
    return () => clearInterval(t);
  }, [sections.length, seconds]);

  const st = menuStyle(props, theme);
  const plain = props.card === false;
  const root: Record<string, string> = { fontFamily: st.fontFamily, fontSize: `${st.fontSize}vw` };
  if (st.color) root.color = st.color;
  if (st.background && !plain) root.background = st.background;
  const accent = st.accent ? { color: st.accent } : undefined;

  if (!menu) return <div class={`${cls} menu dm`} style={root}><div class="dm-empty">Меню ще не опубліковане</div></div>;
  const section = sections[Math.min(idx, sections.length - 1)];
  if (!section) return <div class={`${cls} menu dm`} style={root}><div class="dm-empty">{menu.name}</div></div>;

  const cols = clamp(Number(props.columns ?? 0) || 0, 0, 4);
  const illustrative = section.items.some((i) => i.imageIsAi && i.image);

  return <div class={`${cls} menu dm menu-font-${st.fontId}${plain ? " menu-plain" : ""}${withPhotos ? "" : " dm-list"}`} style={root}>
    <div class="dm-head">
      <div class="menu-title" style={accent}>{String(props.title ?? menu.name)}</div>
      {sections.length > 1 && <div class="dm-sec" style={accent}>{section.name}</div>}
    </div>
    {/* key на розділі: при зміні слайда Preact перемальовує блок і запускає анімацію появи */}
    <div class="dm-grid" key={section.id} style={cols ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : undefined}>
      {section.items.map((i) => <article class={`dm-i${i.inStock ? "" : " gone"}`} key={i.id}>
        {withPhotos && <div class="dm-ph">{i.image ? <img src={`/media/${i.image}`} alt="" loading="lazy" /> : <span class="dm-ph-none" />}</div>}
        <div class="dm-t">
          <div class="dm-n">{i.name}</div>
          {i.description && <div class="dm-d">{i.description}</div>}
        </div>
        <div class="dm-p" style={accent}>
          {i.volume && <span class="dm-v">{i.volume}</span>}
          <span class="menu-price">{i.price === null ? "—" : formatPrice(i.price)}</span>
        </div>
      </article>)}
    </div>
    <div class="dm-foot">
      {sections.length > 1 && <div class="dm-dots">{sections.map((s, n) => <i key={s.id} class={n === idx ? "on" : ""} />)}</div>}
      {illustrative && <div class="dm-note">ілюстративні фото</div>}
    </div>
  </div>;
}
