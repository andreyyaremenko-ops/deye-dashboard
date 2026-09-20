/**
 * Превʼю віджетів на мок-даних (dev-only):
 *   потік:  /preview/?skin=orbit&scene=day&theme=dark
 *   стрінги: /preview/?type=mppt&scene=day&names=Дах%20південь,Дах%20захід
 *   меню:   /preview/?type=text&font=playfair&fs=2&color=%23ffe8c2&accent=%23ffb347&bg=%23301010&alpha=60&card=1
 */
import { render } from "preact";
import "../src/style.css";
import "../src/fonts.css";
import { Widget } from "../src/widgets.tsx";

const q = new URLSearchParams(location.search);
const scenes: Record<string, Record<string, number | string>> = {
  day:    { state: "normal", pv_w: 4200, load_w: 2020, bat_w: -1650, grid_w: -530, bat_soc: 72, grid_v_l1: 231, grid_v_l2: 230, grid_v_l3: 233,
            pv1_w: 1850, pv1_v: 412, pv1_a: 4.5, pv2_w: 1520, pv2_v: 398, pv2_a: 3.8, pv3_w: 830, pv3_v: 305, pv3_a: 2.7, pv4_w: 0, pv4_v: 0, pv4_a: 0 },
  evening:{ state: "standby", pv_w: 0, load_w: 2430, bat_w: 235, grid_w: 2195, bat_soc: 48, grid_v_l1: 229, grid_v_l2: 230, grid_v_l3: 231,
            pv1_w: 0, pv1_v: 0, pv1_a: 0, pv2_w: 0, pv2_v: 0, pv2_a: 0 },
  outage: { state: "normal", pv_w: 120, load_w: 1760, bat_w: 1640, grid_w: 0, bat_soc: 27, grid_v_l1: 0, grid_v_l2: 0, grid_v_l3: 0,
            pv1_w: 90, pv1_v: 260, pv1_a: 0.4, pv2_w: 30, pv2_v: 180, pv2_a: 0.2 },
};
const scene = scenes[q.get("scene") ?? "day"] ?? scenes.day!;
const skin = q.get("skin") ?? "orbit";
const size: Record<string, [number, number]> = { orbit: [30, 42], gauge: [26, 46], sankey: [38, 30], strip: [50, 14], bars: [26, 24] };
const [w, h] = size[skin] ?? [30, 40];
const state = { deviceId: "d", updatedAt: new Date().toISOString(), metrics: scene, stale: false };

const theme = q.get("theme") ?? "dark";
const menuProps = { title: q.get("title") ?? "Меню", text: "Еспресо — 45\nКапучино — 65\nЛате — 70\n# Десерти\nЧізкейк — 95\nТірамісу — 110", theme,
  font: q.get("font") ?? "system", fontSize: q.get("fs") ?? "", color: q.get("color") ?? "", accent: q.get("accent") ?? "", bg: q.get("bg") ?? "", bgAlpha: q.get("alpha") ?? "",
  align: q.get("align") ?? "left", card: q.get("card") !== "0", size: q.get("size") ?? "" };
render(<div class={`screen theme-${theme}`} style={{ background: "radial-gradient(120% 90% at 20% 10%, #3a1b3a 0%, #1a0b1b 55%, #050a12 100%)" }}>
  {q.get("type") === "text"
    ? <div class="slot" style={{ left: "3%", top: "5%", width: "28%", height: "60%" }}><Widget type="text" state={undefined} props={menuProps} /></div>
    : q.get("type") === "mppt"
    ? <div class="slot" style={{ left: "3%", top: "5%", width: "34%", height: "26%" }}><Widget type="mppt" state={state} props={{ card: q.get("card") !== "0", showVA: q.get("va") !== "0", names: (q.get("names") ?? "").split(",").filter(Boolean) }} /></div>
    : <div class="slot" style={{ left: "3%", top: "5%", width: `${w}%`, height: `${h}%` }}><Widget type="flow" state={state} props={{ skin, card: q.get("card") !== "0" }} device={{ batteryKwh: 15, minSoc: 20, pvKwp: 10 }} /></div>}
</div>, document.getElementById("app")!);
