/** Превʼю віджета потоку на мок-даних: /preview/?skin=orbit&scene=day&theme=dark  (dev-only) */
import { render } from "preact";
import "../src/style.css";
import { Widget } from "../src/widgets.tsx";

const q = new URLSearchParams(location.search);
const scenes: Record<string, Record<string, number | string>> = {
  day:    { state: "normal", pv_w: 4200, load_w: 2020, bat_w: -1650, grid_w: -530, bat_soc: 72, grid_v_l1: 231, grid_v_l2: 230, grid_v_l3: 233 },
  evening:{ state: "normal", pv_w: 0, load_w: 2430, bat_w: 235, grid_w: 2195, bat_soc: 48, grid_v_l1: 229, grid_v_l2: 230, grid_v_l3: 231 },
  outage: { state: "normal", pv_w: 120, load_w: 1760, bat_w: 1640, grid_w: 0, bat_soc: 27, grid_v_l1: 0, grid_v_l2: 0, grid_v_l3: 0 },
};
const scene = scenes[q.get("scene") ?? "day"] ?? scenes.day!;
const skin = q.get("skin") ?? "orbit";
const size: Record<string, [number, number]> = { orbit: [30, 40], strip: [50, 14], bars: [26, 24] };
const [w, h] = size[skin] ?? [30, 40];
const state = { deviceId: "d", updatedAt: new Date().toISOString(), metrics: scene, stale: false };

render(<div class={`screen theme-${q.get("theme") ?? "dark"}`} style={{ background: "radial-gradient(120% 90% at 20% 10%, #3a1b3a 0%, #1a0b1b 55%, #050a12 100%)" }}>
  <div class="slot" style={{ left: "3%", top: "5%", width: `${w}%`, height: `${h}%` }}>
    <Widget type="flow" state={state} props={{ skin, card: q.get("card") !== "0" }} />
  </div>
</div>, document.getElementById("app")!);
