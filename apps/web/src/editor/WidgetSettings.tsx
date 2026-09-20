/** Панель властивостей вибраного віджета: спільні поля (пристрій, позиція) + специфічні для типу. */
import type { ReactNode } from "react";
import { MENU_FONTS, MENU_FONT_SIZE, menuStyle } from "@deye/shared/menu";
import type { Device } from "../api.ts";
import { Field } from "../components/ui.tsx";
import { kindOf, type Widget } from "./widgetTypes.ts";

type Theme = "dark" | "light";
type Props = Record<string, unknown>;
interface Ctx { p: Props; set: (patch: Props) => void; theme: Theme }

export function WidgetSettings({ widget, devices, theme, onChange }: { widget: Widget; devices: Device[]; theme: Theme; onChange: (w: Widget) => void }) {
  const p = widget.props ?? {};
  const ctx: Ctx = { p, set: (patch) => onChange({ ...widget, props: { ...p, ...patch } }), theme };
  const pos = (k: "x" | "y" | "w" | "h") => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...widget, [k]: +e.currentTarget.value });
  return <>
    {(kindOf(widget.type)?.needsDevice || (kindOf(widget.type)?.optionalDevice && devices.length > 0)) && <Field label="Пристрій">
      <select value={widget.deviceId ?? ""} onChange={(e) => onChange({ ...widget, deviceId: e.currentTarget.value || undefined })}>
        {kindOf(widget.type)?.optionalDevice && <option value="">без пристрою</option>}
        {devices.map((d) => <option key={d.id} value={d.id}>{d.name ?? d.id}</option>)}
      </select></Field>}
    {SETTINGS[widget.type]?.(ctx)}
    <div className="row quad">
      <Field label="X %"><input type="number" value={widget.x} onChange={pos("x")} /></Field>
      <Field label="Y %"><input type="number" value={widget.y} onChange={pos("y")} /></Field>
      <Field label="Ш %"><input type="number" value={widget.w} onChange={pos("w")} /></Field>
      <Field label="В %"><input type="number" value={widget.h} onChange={pos("h")} /></Field>
    </div>
  </>;
}

// ---------------- елементи форми, привʼязані до props

function Select({ ctx, k, label, options, fallback }: { ctx: Ctx; k: string; label: string; options: [string, string][]; fallback: string }) {
  return <Field label={label}><select value={String(ctx.p[k] ?? fallback)} onChange={(e) => ctx.set({ [k]: e.currentTarget.value })}>
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select></Field>;
}
/** Булеве поле як select із двома підписами; true — перший варіант. */
function Toggle({ ctx, k, label, on, off, fallback = true }: { ctx: Ctx; k: string; label: string; on: string; off: string; fallback?: boolean }) {
  const v = ctx.p[k] === undefined ? fallback : ctx.p[k] !== false;
  return <Field label={label}><select value={v ? "1" : "0"} onChange={(e) => ctx.set({ [k]: e.currentTarget.value === "1" })}>
    <option value="1">{on}</option><option value="0">{off}</option>
  </select></Field>;
}
function Text({ ctx, k, label, placeholder }: { ctx: Ctx; k: string; label: string; placeholder?: string }) {
  return <Field label={label}><input value={String(ctx.p[k] ?? "")} onChange={(e) => ctx.set({ [k]: e.currentTarget.value })} placeholder={placeholder} /></Field>;
}
const Card = (ctx: Ctx) => <Toggle ctx={ctx} k="card" label="Картка" on="з фоном" off="без фону" />;
const Hint = ({ children }: { children: ReactNode }) => <p className="muted small">{children}</p>;

/** Вибір кольору з можливістю повернутись до кольору теми (null). */
function ColorField({ label, value, fallback, onChange }: { label: string; value: string | null; fallback: string; onChange: (v: string | null) => void }) {
  return <Field label={label}>
    <span className="colorfield">
      <input type="color" value={value ?? fallback} onChange={(e) => onChange(e.currentTarget.value)} />
      <span className="muted small">{value ?? "як у теми"}</span>
      {value && <button type="button" className="btn btn-ghost btn-xs" onClick={() => onChange(null)} title="Скинути до кольору теми">×</button>}
    </span>
  </Field>;
}

// ---------------- специфічні панелі

const HEX = /^#[0-9a-f]{6}$/i;
/** Непрозорість картки меню у %; без власного значення — стандарт теми. */
const bgAlpha = (p: Props, theme: Theme) => { const v = Number(p.bgAlpha); return p.bgAlpha !== undefined && p.bgAlpha !== "" && Number.isFinite(v) ? v : theme === "light" ? 70 : 55; };

const SETTINGS: Partial<Record<Widget["type"], (ctx: Ctx) => ReactNode>> = {
  qr: (ctx) => <>
    <Select ctx={ctx} k="mode" label="Тип" fallback="url" options={[["url", "посилання"], ["wifi", "Wi-Fi для гостей"]]} />
    {ctx.p.mode === "wifi" ? <>
      <Text ctx={ctx} k="ssid" label="Назва мережі (SSID)" />
      <Text ctx={ctx} k="password" label="Пароль" />
      <div className="row small">
        <Select ctx={ctx} k="auth" label="Захист" fallback="WPA" options={[["WPA", "WPA/WPA2"], ["WEP", "WEP"], ["nopass", "без пароля"]]} />
        <Toggle ctx={ctx} k="showPassword" label="Пароль на екрані" on="показувати" off="лише QR" />
      </div>
    </> : <Text ctx={ctx} k="url" label="Посилання" />}
    <Text ctx={ctx} k="caption" label="Підпис" />
    {Card(ctx)}
  </>,
  alert: (ctx) => <Toggle ctx={ctx} k="overlay" label="Під час тривоги" on="банер на весь екран" off="лише картка" />,
  outage: (ctx) => <>
    <Toggle ctx={ctx} k="hideWhenOk" label="Коли світло є" on="ховати банер" off="показувати «Світло є»" />
    <Text ctx={ctx} k="note" label="Примітка під час відключення (необовʼязково)" placeholder="Кава і Wi-Fi працюють як зазвичай" />
  </>,
  flow: (ctx) => <>
    <Select ctx={ctx} k="skin" label="Вигляд" fallback="orbit" options={[["orbit", "схема: вузли навколо інвертора"], ["cards", "картки: джерела вгорі, споживачі внизу"], ["gauge", "кільце: звідки береться споживання"], ["sankey", "потоки: стрічки джерело → споживач"], ["strip", "рядок зі стрілками"], ["bars", "смуги"]]} />
    <div className="row small"><Text ctx={ctx} k="title" label="Заголовок" placeholder="Потік енергії" />{Card(ctx)}</div>
    <Hint>Орієнтовний розмір: схема 30×42 %, картки 34×44 %, кільце 26×46 %, потоки 38×30 %, рядок 50×14 %, смуги 26×24 %. Автономія в підсумку зʼявиться, якщо в пристрої вказано ємність батареї.</Hint>
  </>,
  mppt: (ctx) => {
    const names = Array.isArray(ctx.p.names) ? (ctx.p.names as unknown[]).map(String) : [];
    return <>
      <div className="row small"><Text ctx={ctx} k="title" label="Заголовок" placeholder="Стрінги" />{Card(ctx)}</div>
      <Toggle ctx={ctx} k="showVA" label="Вольти й ампери" on="показувати" off="лише кіловати" />
      <Field label="Назви входів (по одній на рядок, у порядку MPPT 1…4)">
        <textarea rows={4} value={names.join("\n")} onChange={(e) => ctx.set({ names: e.currentTarget.value.split(/\r?\n/) })} placeholder={"Дах південь\nДах захід"} />
      </Field>
      <Hint>Генерація кожного входу панелей окремо. Входи, яких немає або не підключені, ховаються. Орієнтовний розмір 34×30 %.</Hint>
    </>;
  },
  weather: () => <Hint>Прогноз генерації на завтра зʼявиться, якщо в пристрої вказано потужність панелей (kWp).</Hint>,
  chart: (ctx) => <Field label="Період"><select value={String(ctx.p.hours ?? 24)} onChange={(e) => ctx.set({ hours: Number(e.currentTarget.value) })}>
    <option value="24">24 години</option><option value="72">3 доби</option><option value="168">тиждень</option></select></Field>,
  text: (ctx) => {
    const st = menuStyle(ctx.p, ctx.theme);
    const themeFg = ctx.theme === "light" ? "#10203a" : "#ffffff";
    const card = ctx.p.card !== false;
    return <>
      <Text ctx={ctx} k="title" label="Заголовок" placeholder="Меню" />
      <Field label="Рядки (назва — ціна; рядок з # це підзаголовок)">
        <textarea rows={10} value={String(ctx.p.text ?? "")} onChange={(e) => ctx.set({ text: e.currentTarget.value })} style={{ fontFamily: st.fontFamily }} />
      </Field>
      <div className="row small">
        <Field label="Шрифт"><select value={st.fontId} onChange={(e) => ctx.set({ font: e.currentTarget.value })} style={{ fontFamily: st.fontFamily }}>
          {MENU_FONTS.map((f) => <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>{f.label}</option>)}
        </select></Field>
        <Field label={`Розмір ${st.fontSize.toFixed(1)}`}><input type="range" min={MENU_FONT_SIZE.min} max={MENU_FONT_SIZE.max} step={MENU_FONT_SIZE.step} value={st.fontSize} onChange={(e) => ctx.set({ fontSize: +e.currentTarget.value, size: undefined })} /></Field>
      </div>
      <div className="row small">
        <ColorField label="Колір тексту" value={st.color} fallback={themeFg} onChange={(v) => ctx.set({ color: v ?? "" })} />
        <ColorField label="Заголовок і ціни" value={st.accent} fallback={st.color ?? themeFg} onChange={(v) => ctx.set({ accent: v ?? "" })} />
      </div>
      <div className="row small">
        <Select ctx={ctx} k="align" label="Вирівнювання" fallback="left" options={[["left", "ліворуч"], ["center", "по центру"]]} />
        {Card(ctx)}
      </div>
      {card && <div className="row small">
        <ColorField label="Колір картки" value={typeof ctx.p.bg === "string" && HEX.test(ctx.p.bg) ? ctx.p.bg : null} fallback={ctx.theme === "light" ? "#ffffff" : "#0a101c"} onChange={(v) => ctx.set({ bg: v ?? "" })} />
        <Field label={`Прозорість картки ${Math.round(bgAlpha(ctx.p, ctx.theme))}%`}><input type="range" min={0} max={100} step={5} value={bgAlpha(ctx.p, ctx.theme)} onChange={(e) => ctx.set({ bgAlpha: +e.currentTarget.value })} /></Field>
      </div>}
    </>;
  },
};
