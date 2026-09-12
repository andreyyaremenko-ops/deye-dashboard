#!/usr/bin/env python3
"""
Декодер дампу для трифазних гібридів Deye (SUN-xK-SG01HP3 / SG04LP3, reg 0 = 5/6).
Читає JSON із solarman_spike.py і друкує зрозумілі значення.

  python3 decode_hp3.py dumps/<file>.json
"""
import json
import sys

# (регістр, назва, множник, одиниця, signed)
MAP = [
    (500, "Стан інвертора", 1, "", False),
    (514, "Заряд батареї за день", 0.1, "kWh", False),
    (515, "Розряд батареї за день", 0.1, "kWh", False),
    (520, "Куплено з мережі за день", 0.1, "kWh", False),
    (521, "Продано в мережу за день", 0.1, "kWh", False),
    (526, "Споживання за день", 0.1, "kWh", False),
    (529, "Генерація PV за день", 0.1, "kWh", False),
    (540, "Темп. DC-трансформатора", 0.1, "°C", False, -100),
    (541, "Темп. радіатора", 0.1, "°C", False, -100),
    (586, "Темп. батареї", 0.1, "°C", False, -100),
    (587, "Напруга батареї", 0.1, "V", False),
    (588, "SOC батареї", 1, "%", False),
    (590, "Потужність батареї (+розряд/-заряд)", 1, "W", True),
    (591, "Струм батареї", 0.01, "A", True),
    (598, "Мережа U L1", 0.1, "V", False),
    (599, "Мережа U L2", 0.1, "V", False),
    (600, "Мережа U L3", 0.1, "V", False),
    (610, "Мережа I L1", 0.01, "A", True),
    (611, "Мережа I L2", 0.01, "A", True),
    (612, "Мережа I L3", 0.01, "A", True),
    (604, "Мережа P L1 (внутр. CT)", 1, "W", True),
    (605, "Мережа P L2 (внутр. CT)", 1, "W", True),
    (606, "Мережа P L3 (внутр. CT)", 1, "W", True),
    (607, "Мережа P всього (+імпорт/-експорт)", 1, "W", True),
    (609, "Частота мережі", 0.01, "Hz", False),
    (627, "Інвертор U L1", 0.1, "V", False),
    (628, "Інвертор U L2", 0.1, "V", False),
    (629, "Інвертор U L3", 0.1, "V", False),
    (630, "Інвертор I L1", 0.01, "A", True),
    (631, "Інвертор I L2", 0.01, "A", True),
    (632, "Інвертор I L3", 0.01, "A", True),
    (633, "Інвертор P L1", 1, "W", True),
    (634, "Інвертор P L2", 1, "W", True),
    (635, "Інвертор P L3", 1, "W", True),
    (636, "Інвертор P всього", 1, "W", True),
    (638, "Частота інвертора", 0.01, "Hz", False),
    (644, "Навантаження U L1", 0.1, "V", False),
    (645, "Навантаження U L2", 0.1, "V", False),
    (646, "Навантаження U L3", 0.1, "V", False),
    (650, "Навантаження P L1", 1, "W", True),
    (651, "Навантаження P L2", 1, "W", True),
    (652, "Навантаження P L3", 1, "W", True),
    (653, "Навантаження P всього", 1, "W", True),
    (655, "Частота навантаження", 0.01, "Hz", False),
    (672, "PV1 потужність (масштаб ×10 — перевірити)", 10, "W", False),
    (673, "PV2 потужність (масштаб ×10 — перевірити)", 10, "W", False),
    (676, "PV1 напруга", 0.1, "V", False),
    (677, "PV1 струм", 0.1, "A", False),
    (678, "PV2 напруга", 0.1, "V", False),
    (679, "PV2 струм", 0.1, "A", False),
]
# 32-бітні лічильники: (low_reg, high_reg, назва, множник, одиниця)
MAP32 = [
    (516, 517, "Заряд батареї всього", 0.1, "kWh"),
    (518, 519, "Розряд батареї всього", 0.1, "kWh"),
    (522, 523, "Куплено з мережі всього", 0.1, "kWh"),
    (524, 525, "Продано в мережу всього", 0.1, "kWh"),
    (527, 528, "Споживання всього", 0.1, "kWh"),
    (534, 535, "Генерація PV всього", 0.1, "kWh"),
    (20, 21, "Номінальна потужність", 0.1, "W"),
]
STATE = {0: "standby", 1: "self-check", 2: "normal", 3: "alarm", 4: "fault"}
TYPES = {2: "string", 3: "1-phase hybrid", 4: "micro", 5: "3-phase LV hybrid", 6: "3-phase HV hybrid"}


def main(path):
    d = json.load(open(path))
    r = {int(k): v["dec"] for k, v in d["registers"].items()}
    print(f"Дамп {path}, {d['captured_at']}")
    print(f"Тип: {TYPES.get(r.get(0), r.get(0))}; серійник: "
          f"{bytes().join(r[i].to_bytes(2, 'big') for i in range(3, 8)).decode()}")
    print()
    for lo, hi, name, k, unit in MAP32:
        if lo in r and hi in r:
            print(f"  {name:42s} {(r[hi] << 16 | r[lo]) * k:12.1f} {unit}")
    print()
    for item in MAP:
        reg, name, k, unit, signed = item[:5]
        offset = item[5] if len(item) > 5 else 0
        if reg not in r:
            continue
        v = r[reg]
        if signed and v & 0x8000:
            v -= 0x10000
        val = v * k + offset
        if reg == 500:
            print(f"  {name:42s} {STATE.get(v, v)}")
        else:
            print(f"  {name:42s} {val:12.2f} {unit}")

    # Перевірка узгодженості: мережа + інвертор = навантаження
    if all(x in r for x in (607, 636, 653)):
        s = lambda x: x - 0x10000 if x & 0x8000 else x
        print(f"\n  Перевірка: мережа {s(r[607])} + інвертор {s(r[636])} = "
              f"{s(r[607]) + s(r[636])} vs навантаження {s(r[653])}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else sorted(__import__('glob').glob('dumps/*.json'))[-1])
