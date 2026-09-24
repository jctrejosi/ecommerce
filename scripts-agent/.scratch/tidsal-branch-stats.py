#!/usr/bin/env python3
"""Tamano del catalogo por sucursal en TIDSAL."""
import struct
from collections import defaultdict
from pathlib import Path

BASE = 0x190
DESC = 200


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


data = Path("db/ADD_CONTAB/TIDSAL.adt").read_bytes()
hdr = u32(data, 0x20)
rlen = u32(data, 0x24)
n = u32(data, 0x18)
head = data[:hdr]
f = {}
for i in range((hdr - BASE) // DESC):
    d = head[BASE + i * DESC:BASE + (i + 1) * DESC]
    nm = d[:0x80].split(b"\0", 1)[0].decode(errors="replace")
    if nm:
        f[nm] = (d[0x81], u16(d, 0x83), d[0x87])


def ch(rec, nm):
    t, off, ln = f[nm]
    return rec[off:off + ln].decode("latin-1").rstrip("\x00 ").strip()


rows = defaultdict(lambda: {"total": 0, "activos": 0, "web": 0, "web_act": 0,
                            "artic": set()})
all_artic = set()
for i in range(n):
    o = hdr + i * rlen
    rec = data[o:o + rlen]
    s = int(struct.unpack("<d", rec[f["INSUC"][1]:f["INSUC"][1] + 8])[0])
    art = ch(rec, "INARTIC")
    act = ch(rec, "INACTIVO") == "A"
    web = ch(rec, "INWEB") == "T"
    r = rows[s]
    r["total"] += 1
    r["activos"] += act
    r["web"] += web
    r["web_act"] += (web and act)
    r["artic"].add(art)
    all_artic.add(art)

print("sucursal | filas | activos | INWEB=T | web&activo | articulos")
for s in sorted(rows):
    r = rows[s]
    print(f"  {s:>3}    | {r['total']:>6} | {r['activos']:>7} | {r['web']:>6} | "
          f"{r['web_act']:>9} | {len(r['artic'])}")
print(f"articulos distintos (global): {len(all_artic)}")
