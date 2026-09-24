#!/usr/bin/env python3
"""Verifica que fuente resuelve los codigos de clasificacion de TIDSAL:
TIDTAB (ADD_CONTAB) vs CATEGORIAS.JSON / TIPOS_PRODUCTOS.JSON (exports viejos).
"""
import json
import struct
from collections import Counter
from pathlib import Path

BASE = 0x190
DESC = 200


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def load_adt(path):
    data = Path(path).read_bytes()
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
    return data, hdr, rlen, n, f


def ch(rec, f, nm):
    t, off, ln = f[nm]
    return rec[off:off + ln].decode("latin-1").rstrip("\x00 ").strip()


data, hdr, rlen, n, f = load_adt("db/ADD_CONTAB/TIDSAL.adt")

pref = {1: Counter(), 3: Counter(), 5: Counter(), 7: Counter()}
tipos = Counter()
for i in range(n):
    rec = data[hdr + i * rlen: hdr + (i + 1) * rlen]
    art = ch(rec, f, "INARTIC")
    for L in (1, 3, 5, 7):
        if len(art) >= L:
            pref[L][art[:L]] += 1
    tipos[ch(rec, f, "INTIPO")] += 1

# fuentes
tidtab_codes = set()
d2, h2, r2, n2, f2 = load_adt("db/ADD_CONTAB/TIDTAB.ADT")
for i in range(n2):
    tidtab_codes.add(ch(d2[h2 + i * r2:h2 + (i + 1) * r2], f2, "CTABCOD"))

cat_json = set()
p = Path("backend/data/JSON/CATEGORIAS.JSON")
if p.exists():
    for row in json.load(open(p, encoding="cp1252"))["CATEGORIAS"]:
        cat_json.add(row["CODIGO"].strip())

tipos_json = {}
p = Path("backend/data/JSON/TIPOS_PRODUCTOS.JSON")
if p.exists():
    for row in json.load(open(p, encoding="cp1252"))["TIPOS_PRODUCTOS"]:
        tipos_json[row["CODIGO"].strip()] = row["NOMBRE"].strip()


def pct(hit, tot):
    return f"{hit}/{tot} ({100 * hit // max(tot,1)}%)"


print("== prefijos INARTIC vs fuentes ==")
for L in (1, 3, 5, 7):
    v = pref[L]
    print(f"  len {L}: {len(v)} distintos | en TIDTAB: "
          f"{pct(sum(1 for k in v if k in tidtab_codes), len(v))} | en CATEGORIAS.JSON: "
          f"{pct(sum(1 for k in v if k in cat_json), len(v))}")

print(f"\n== INTIPO ({len(tipos)} distintos) ==")
print(f"  en TIDTAB        : {pct(sum(1 for k in tipos if k in tidtab_codes), len(tipos))}")
print(f"  en TIPOS_PRODUCTOS: {pct(sum(1 for k in tipos if k in tipos_json), len(tipos))}")
print("  top tipos:", ", ".join(f"{k}x{c}" for k, c in tipos.most_common(8)))
for k, _ in tipos.most_common(6):
    print(f"    {k}: TIPOS_PRODUCTOS={tipos_json.get(k)!r}")
