/**
 * Превʼю віджетів на мок-даних (dev-only):
 *   потік:  /preview/?skin=orbit&scene=day|evening|hv|outage|micro&theme=dark   (micro — 50 kW з мікроінвертором на GEN-порту)
 *   стрінги: /preview/?type=mppt&scene=day|hv&names=Дах%20південь,Дах%20захід   (hv — 30 kW HV з трьома MPPT)
 *   меню:   /preview/?type=text&font=playfair&fs=2&color=%23ffe8c2&accent=%23ffb347&bg=%23301010&alpha=60&card=1
 *   AI-меню: /preview/?type=menu&photos=0&cols=3&out=strike   (фото беруться з /media, тут їх нема — картки без фото)
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
  hv:     { state: "normal", pv_w: 46200, load_w: 3120, bat_w: -24800, grid_w: -18200, bat_soc: 64, grid_v_l1: 231, grid_v_l2: 232, grid_v_l3: 230,
            pv1_w: 16600, pv1_v: 720, pv1_a: 20.0, pv2_w: 16700, pv2_v: 721, pv2_a: 20.0, pv3_w: 12900, pv3_v: 629, pv3_a: 19.5, pv4_w: 0, pv4_v: 0, pv4_a: 0 },
  outage: { state: "normal", pv_w: 120, load_w: 1760, bat_w: 1640, grid_w: 0, bat_soc: 27, grid_v_l1: 0, grid_v_l2: 0, grid_v_l3: 0,
            pv1_w: 90, pv1_v: 260, pv1_a: 0.4, pv2_w: 30, pv2_v: 180, pv2_a: 0.2 },
  // Budmayster 26.09.2026 10:44: 50 kW HV, мікроінвертор на GEN-порту (реальний кадр зі spike/dumps/2947846131_*)
  micro:  { state: "normal", pv_w: 24590, load_w: 26588, bat_w: -23640, grid_w: 16151, bat_soc: 47, grid_v_l1: 228, grid_v_l2: 230, grid_v_l3: 233,
            gen_w: 10650, gen_w_l1: 3533, gen_w_l2: 3591, gen_w_l3: 3526, gen_v_l1: 228.8, gen_day_kwh: 22.5, gen_total_kwh: 10706.8,
            pv_day_kwh: 32.8, load_day_kwh: 74.4, grid_buy_day_kwh: 2.3, grid_sell_day_kwh: 0.6,
            pv1_w: 4380, pv1_v: 288, pv1_a: 15.2, pv2_w: 6850, pv2_v: 464, pv2_a: 14.7, pv3_w: 5190, pv3_v: 345, pv3_a: 15, pv4_w: 8170, pv4_v: 541, pv4_a: 15.1 },
};
const scene = scenes[q.get("scene") ?? "day"] ?? scenes.day!;
const skin = q.get("skin") ?? "orbit";
const size: Record<string, [number, number]> = { orbit: [30, 42], cards: [34, 44], gauge: [26, 46], sankey: [38, 30], strip: [50, 14], bars: [26, 24] };
const [w, h] = size[skin] ?? [30, 40];
const state = { deviceId: "d", updatedAt: new Date().toISOString(), metrics: scene, stale: false };

const theme = q.get("theme") ?? "dark";
const menuProps = { title: q.get("title") ?? "Меню", text: "Еспресо — 45\nКапучино — 65\nЛате — 70\n# Десерти\nЧізкейк — 95\nТірамісу — 110", theme,
  font: q.get("font") ?? "system", fontSize: q.get("fs") ?? "", color: q.get("color") ?? "", accent: q.get("accent") ?? "", bg: q.get("bg") ?? "", bgAlpha: q.get("alpha") ?? "",
  align: q.get("align") ?? "left", card: q.get("card") !== "0", size: q.get("size") ?? "" };
// мок опублікованого меню: те саме, що віддає publicScreen()
const mockMenu = {
  id: "m1", name: "Барна карта", updatedAt: new Date().toISOString(),
  sections: [
    { id: "s1", name: "Кава", items: [
      { id: "i1", name: "Еспресо", description: null, price: 4500, volume: "30 мл", inStock: true, image: null, imageIsAi: true },
      { id: "i2", name: "Капучино", description: "на вівсяному за бажанням", price: 6500, volume: "250 мл", inStock: true, image: null, imageIsAi: true },
      { id: "i3", name: "Лате", description: null, price: 7000, volume: "300 мл", inStock: false, image: null, imageIsAi: true },
      { id: "i4", name: "Раф солона карамель", description: null, price: 9500, volume: "300 мл", inStock: true, image: null, imageIsAi: false },
    ] },
    { id: "s2", name: "Десерти", items: [
      { id: "i5", name: "Чізкейк Нью-Йорк", description: "з ягідним соусом", price: 9500, volume: "120 г", inStock: true, image: null, imageIsAi: true },
      { id: "i6", name: "Тірамісу", description: null, price: 11000, volume: "140 г", inStock: true, image: null, imageIsAi: true },
    ] },
  ],
};
const dishMenuProps = { ...menuProps, menuId: "m1", photos: q.get("photos") !== "0", columns: q.get("cols") ?? 0,
  sectionS: q.get("secs") ?? 15, outOfStock: q.get("out") ?? "hide", title: q.get("title") ?? "" };

render(<div class={`screen theme-${theme}`} style={{ background: "radial-gradient(120% 90% at 20% 10%, #3a1b3a 0%, #1a0b1b 55%, #050a12 100%)" }}>
  {q.get("type") === "menu"
    ? <div class="slot" style={{ left: "3%", top: "5%", width: "46%", height: "72%" }}><Widget type="menu" state={undefined} props={dishMenuProps} menus={{ m1: mockMenu }} /></div>
    : q.get("type") === "text"
    ? <div class="slot" style={{ left: "3%", top: "5%", width: "28%", height: "60%" }}><Widget type="text" state={undefined} props={menuProps} /></div>
    : q.get("type") === "mppt"
    ? <div class="slot" style={{ left: "3%", top: "5%", width: "34%", height: "26%" }}><Widget type="mppt" state={state} props={{ card: q.get("card") !== "0", showVA: q.get("va") !== "0", names: (q.get("names") ?? "").split(",").filter(Boolean) }} /></div>
    : q.get("type") === "energy_today"
    ? <div class="slot" style={{ left: "3%", top: "5%", width: "20%", height: "26%" }}><Widget type="energy_today" state={state} props={{}} /></div>
    : <div class="slot" style={{ left: "3%", top: "5%", width: `${w}%`, height: `${h}%` }}><Widget type="flow" state={state} props={{ skin, card: q.get("card") !== "0", genLabel: q.get("gen") ?? "" }} device={{ batteryKwh: 15, minSoc: 20, pvKwp: 10 }} /></div>}
</div>, document.getElementById("app")!);
