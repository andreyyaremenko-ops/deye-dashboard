#!/usr/bin/env python3
"""
Spike: знайти Solarman WiFi-стік у локальній мережі, прочитати сирі регістри
інвертора Deye по протоколу Solarman V5 і зберегти дампи для тестів парсера.

Без залежностей, тільки stdlib (Python 3.10+).

Приклади:
  python3 solarman_spike.py                      # пошук + читання стандартних діапазонів
  python3 solarman_spike.py --discover-only      # тільки пошук стіків
  python3 solarman_spike.py --host 192.168.1.50 --serial 2712345678
  python3 solarman_spike.py --scan 192.168.1.0/24  # якщо broadcast не працює
  python3 solarman_spike.py --ranges 0-120,500-700  # свої діапазони
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import random
import socket
import struct
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

DISCOVERY_MSG = b"WIFIKIT-214028-READ"
DISCOVERY_PORT = 48899
MODBUS_PORT = 8899

# Діапазони регістрів Deye, які варто спробувати. Різні моделі відповідають
# на різні діапазони; ті, що дають modbus-exception, просто пропускаються.
#   0-120    : інфо про пристрій (тип, серійник, версії) + string-інвертори
#   150-250  : однофазні гібриди (SUN-xK-SG0xLP1), батарея/мережа
#   500-700  : трифазні гібриди (SUN-xK-SG04LP3 / HP3)
DEFAULT_RANGES = [(0, 120), (150, 250), (500, 700)]
CHUNK = 60  # регістрів за один modbus-запит; стік не любить великі кадри

DEVICE_TYPES = {
    0x0002: "string inverter",
    0x0003: "single-phase hybrid",
    0x0004: "micro inverter",
    0x0005: "three-phase LV hybrid",
    0x0006: "three-phase HV hybrid",
}


# ---------------------------------------------------------------- Modbus RTU

def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc


def modbus_read_holding(slave: int, start: int, count: int) -> bytes:
    frame = struct.pack(">BBHH", slave, 0x03, start, count)
    return frame + struct.pack("<H", crc16(frame))


def modbus_parse_response(frame: bytes, expected_count: int) -> list[int]:
    if len(frame) < 5:
        raise ValueError(f"modbus frame too short: {frame.hex()}")
    if crc16(frame[:-2]) != struct.unpack("<H", frame[-2:])[0]:
        raise ValueError(f"modbus CRC mismatch: {frame.hex()}")
    func = frame[1]
    if func & 0x80:
        raise ModbusException(frame[2])
    if func != 0x03:
        raise ValueError(f"unexpected function 0x{func:02x}: {frame.hex()}")
    byte_count = frame[2]
    data = frame[3:3 + byte_count]
    regs = [struct.unpack(">H", data[i:i + 2])[0] for i in range(0, len(data), 2)]
    if len(regs) != expected_count:
        raise ValueError(f"expected {expected_count} regs, got {len(regs)}")
    return regs


class ModbusException(Exception):
    CODES = {1: "illegal function", 2: "illegal data address",
             3: "illegal data value", 4: "slave device failure"}

    def __init__(self, code: int):
        self.code = code
        super().__init__(f"modbus exception {code} ({self.CODES.get(code, '?')})")


# ------------------------------------------------------------- Solarman V5

class V5Client:
    """Мінімальна реалізація Solarman V5 поверх TCP (порт 8899)."""

    def __init__(self, host: str, serial: int, port: int = MODBUS_PORT,
                 timeout: float = 8.0, verbose: bool = False):
        self.host, self.port, self.serial = host, port, serial
        self.timeout, self.verbose = timeout, verbose
        self.seq = random.randint(1, 0xFE)  # V5 seq — один байт, другий стік заповнює сам
        self.sock: socket.socket | None = None
        self.log: list[dict] = []

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port), self.timeout)
        self.sock.settimeout(self.timeout)

    def close(self):
        if self.sock:
            self.sock.close()
            self.sock = None

    def _build(self, modbus: bytes) -> bytes:
        payload = (struct.pack("<BHIII", 0x02, 0x0000, 0, 0, 0) + modbus)
        header = struct.pack("<BHHHI", 0xA5, len(payload), 0x4510, self.seq, self.serial)
        body = header + payload
        checksum = sum(body[1:]) & 0xFF
        return body + bytes([checksum, 0x15])

    def _recv_frame(self) -> bytes:
        assert self.sock
        head = self._recv_exact(11)
        if head[0] != 0xA5:
            raise ValueError(f"bad start byte: {head.hex()}")
        length = struct.unpack("<H", head[1:3])[0]
        rest = self._recv_exact(length + 2)
        frame = head + rest
        if frame[-1] != 0x15:
            raise ValueError(f"bad end byte: {frame.hex()}")
        if (sum(frame[1:-2]) & 0xFF) != frame[-2]:
            raise ValueError(f"V5 checksum mismatch: {frame.hex()}")
        return frame

    def _recv_exact(self, n: int) -> bytes:
        assert self.sock
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("socket closed by stick")
            buf += chunk
        return buf

    def read_holding(self, start: int, count: int, slave: int = 1) -> list[int]:
        assert self.sock, "not connected"
        self.seq = (self.seq + 1) & 0xFF or 1
        req = self._build(modbus_read_holding(slave, start, count))
        if self.verbose:
            print(f"    >> {req.hex()}")
        self.sock.sendall(req)

        # Стік інколи шле інші кадри (heartbeat 0x4710 тощо) — пропускаємо
        # все, що не є відповіддю 0x1510 на наш seq.
        for _ in range(5):
            resp = self._recv_frame()
            if self.verbose:
                print(f"    << {resp.hex()}")
            control = struct.unpack("<H", resp[3:5])[0]
            if control == 0x1510 and resp[5] == self.seq:
                break
        else:
            raise ValueError("no matching V5 response after 5 frames")

        entry = {"start": start, "count": count, "request": req.hex(),
                 "response": resp.hex()}
        self.log.append(entry)

        # payload: frame_type(1) status(1) total_working_time(4) power_on_time(4)
        #          offset_time(4) modbus... ; checksum(1) end(1)
        status = resp[12]
        modbus = resp[25:-2]
        if status != 0x01 and self.verbose:
            print(f"    !! V5 status byte 0x{status:02x}")
        regs = modbus_parse_response(modbus, count)
        entry["registers"] = regs
        return regs


# --------------------------------------------------------------- Discovery

def discover(timeout: float = 3.0) -> list[dict]:
    """UDP broadcast WIFIKIT-214028-READ -> 'IP,MAC,SERIAL' від кожного стіка."""
    found: dict[str, dict] = {}
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.settimeout(timeout)
        for _ in range(2):
            s.sendto(DISCOVERY_MSG, ("255.255.255.255", DISCOVERY_PORT))
            deadline = time.time() + timeout
            while time.time() < deadline:
                try:
                    data, addr = s.recvfrom(1024)
                except socket.timeout:
                    break
                text = data.decode(errors="replace").strip()
                parts = text.split(",")
                if len(parts) >= 3:
                    found[parts[0]] = {"ip": parts[0], "mac": parts[1],
                                       "serial": parts[2], "raw": text,
                                       "from": addr[0]}
                elif text and text != DISCOVERY_MSG.decode():
                    found[addr[0]] = {"ip": addr[0], "raw": text, "from": addr[0]}
    return list(found.values())


def scan_subnet(cidr: str, timeout: float = 0.5) -> list[str]:
    """Резерв: перебір підмережі по відкритому TCP 8899."""
    net = ipaddress.ip_network(cidr, strict=False)

    def probe(ip: str) -> str | None:
        try:
            with socket.create_connection((ip, MODBUS_PORT), timeout):
                return ip
        except OSError:
            return None

    with ThreadPoolExecutor(max_workers=64) as ex:
        return [ip for ip in ex.map(probe, (str(h) for h in net.hosts())) if ip]


# ----------------------------------------------------------------- Helpers

def parse_ranges(text: str) -> list[tuple[int, int]]:
    out = []
    for part in text.split(","):
        a, b = part.split("-")
        out.append((int(a, 0), int(b, 0)))
    return out


def regs_to_ascii(regs: list[int]) -> str:
    b = b"".join(struct.pack(">H", r) for r in regs)
    return b.decode("ascii", errors="replace")


def describe_device(regs: dict[int, int]):
    if 0 in regs:
        t = regs[0]
        print(f"  Тип пристрою (reg 0): 0x{t:04x} -> {DEVICE_TYPES.get(t, 'невідомий')}")
    if all(i in regs for i in range(3, 8)):
        print(f"  Серійник інвертора (reg 3-7): {regs_to_ascii([regs[i] for i in range(3, 8)])!r}")
    if 20 in regs and 21 in regs:
        rated = (regs[21] << 16 | regs[20]) / 10
        print(f"  Номінальна потужність (reg 20-21): {rated:.0f} W")
    if all(i in regs for i in (11, 12, 13)):
        print(f"  Версії (reg 11-13): {regs[11]:04x} {regs[12]:04x} {regs[13]:04x}")


def read_ranges(client: V5Client, ranges: list[tuple[int, int]],
                chunk: int) -> dict[int, int]:
    regs: dict[int, int] = {}
    for lo, hi in ranges:
        start = lo
        while start < hi:
            count = min(chunk, hi - start)
            label = f"  regs {start:5d}-{start + count - 1:5d} ({count:3d})"
            try:
                vals = client.read_holding(start, count)
                for i, v in enumerate(vals):
                    regs[start + i] = v
                nonzero = sum(1 for v in vals if v)
                print(f"{label}: ok, {nonzero}/{count} ненульових")
            except ModbusException as e:
                print(f"{label}: {e} — пропускаю діапазон")
                break
            except (socket.timeout, TimeoutError):
                print(f"{label}: timeout — повторюю один раз")
                try:
                    client.close(); client.connect()
                    vals = client.read_holding(start, count)
                    for i, v in enumerate(vals):
                        regs[start + i] = v
                    print(f"{label}: ok після повтору")
                except Exception as e2:  # noqa: BLE001
                    print(f"{label}: знову помилка ({e2}) — пропускаю діапазон")
                    break
            except Exception as e:  # noqa: BLE001
                print(f"{label}: помилка: {e}")
                break
            start += count
            time.sleep(0.3)  # стік не любить бомбардування
    return regs


# -------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", help="IP стіка (пропустити пошук)")
    ap.add_argument("--serial", type=int, help="серійник логера (число, 10 цифр)")
    ap.add_argument("--scan", metavar="CIDR", help="сканувати підмережу по TCP 8899")
    ap.add_argument("--discover-only", action="store_true")
    ap.add_argument("--ranges", help="діапазони, напр. 0-120,500-700")
    ap.add_argument("--chunk", type=int, default=CHUNK)
    ap.add_argument("--slave", type=int, default=1, help="modbus slave id (зазвичай 1)")
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--out", default="dumps", help="каталог для JSON-дампів")
    ap.add_argument("-v", "--verbose", action="store_true", help="друкувати hex кадрів")
    args = ap.parse_args()

    host, serial, disc_info = args.host, args.serial, None

    if not host or not serial:
        print("Пошук стіків (UDP broadcast 48899)...")
        sticks = discover()
        for s in sticks:
            print(f"  знайдено: {s}")
        if not sticks:
            print("  нічого не знайдено")
            if args.scan:
                print(f"Сканую {args.scan} по TCP {MODBUS_PORT}...")
                for ip in scan_subnet(args.scan):
                    print(f"  відкритий 8899: {ip}")
                print("  Серійник візьми з наліпки на стіку або з його web-UI "
                      "(http://IP, admin/admin) і запусти з --host/--serial.")
            elif not host:
                print("  Спробуй --scan 192.168.1.0/24 (підстав свою підмережу) "
                      "або задай --host і --serial вручну.")
        if args.discover_only:
            return 0
        if sticks and not host:
            disc_info = sticks[0]
            host = disc_info["ip"]
        if sticks and not serial and disc_info and "serial" in disc_info:
            serial = int(disc_info["serial"])
    if not host or not serial:
        print("Немає host або serial — зупиняюсь.")
        return 1

    ranges = parse_ranges(args.ranges) if args.ranges else DEFAULT_RANGES
    print(f"\nПідключаюсь до {host}:{MODBUS_PORT}, serial={serial}")
    print("(переконайся, що ніхто інший не тримає TCP 8899 — Home Assistant, Solar Assistant тощо)")

    client = V5Client(host, serial, timeout=args.timeout, verbose=args.verbose)
    try:
        client.connect()
    except OSError as e:
        print(f"Не вдалось підключитись: {e}")
        return 1

    started = datetime.now(timezone.utc)
    try:
        regs = read_ranges(client, ranges, args.chunk)
    finally:
        client.close()

    print(f"\nПрочитано {len(regs)} регістрів.")
    describe_device(regs)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = out_dir / f"{serial}_{started.strftime('%Y%m%dT%H%M%SZ')}.json"
    dump = {
        "captured_at": started.isoformat(),
        "stick": {"host": host, "serial": serial, "discovery": disc_info},
        "ranges": ranges,
        "frames": client.log,
        "registers": {str(k): {"dec": v, "hex": f"{v:04x}"} for k, v in sorted(regs.items())},
    }
    fname.write_text(json.dumps(dump, ensure_ascii=False, indent=2))
    print(f"Дамп збережено: {fname}")

    print("\nНенульові регістри:")
    for k, v in sorted(regs.items()):
        if v:
            signed = v - 0x10000 if v & 0x8000 else v
            print(f"  {k:5d}  0x{v:04x}  {v:6d}  {signed:7d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
