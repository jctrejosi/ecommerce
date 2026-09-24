#!/usr/bin/env python3
"""Cruza INPROVEE (TIDSAL) con CONTERCE (NIT/CODIGO -> MNOMBRE)."""
import struct
from collections import Counter
from pathlib import Path

BASE = 0x190
DESC = 200


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def load(path):
    data = Path(path).read_bytes()
    hdr = u32(data, 0x20)
    rlen = u32(data, 0x24)
    n = u32(data, 0x18)
    f = {}
    for i in range((hdr - BASE) // DESC):
        d = data[BASE + i * DESC:BASE + (i + 1) * DESC]
        nm = d[:0x80].split(b"\0", 1)[0].decode(errors="replace")
        if nm:
            f[nm] = (d[0x81], u16(d, 0x83), d[0x87])
    return data, hdr, rlen, n, f


def ch(rec, f, nm):
    _, off, ln = f[nm]
    return rec[off:off + ln].decode("latin-1").rstrip("\x00 ").strip()


sal_d, sal_h, sal_r, sal_n, sal_f = load("db/ADD_CONTAB/TIDSAL.adt")
prov = Counter()
for i in range(sal_n):
    rec = sal_d[sal_h + i * sal_r: sal_h + (i + 1) * sal_r]
    p = ch(rec, sal_f, "INPROVEE")
    if p:
        prov[p] += 1
print(f"INPROVEE distintos: {len(prov)}")

need = set(prov)
ter_d, ter_h, ter_r, ter_n, ter_f = load("db/ADD_CONTAB/CONTERCE.adt")
by_nit = {}
by_cod = {}
for i in range(ter_n):
    rec = ter_d[ter_h + i * ter_r: ter_h + (i + 1) * ter_r]
    nit = ch(rec, ter_f, "NIT")
    cod = ch(rec, ter_f, "CODIGO")
    if nit in need and nit not in by_nit:
        by_nit[nit] = ch(rec, ter_f, "MNOMBRE")
    if cod in need and cod not in by_cod:
        by_cod[cod] = ch(rec, ter_f, "MNOMBRE")

hit_nit = sum(1 for k in need if k in by_nit)
hit_cod = sum(1 for k in need if k in by_cod)
print(f"match por NIT: {hit_nit}/{len(need)}   por CODIGO: {hit_cod}/{len(need)}")
for k, c in prov.most_common(8):
    print(f"  {k!r} x{c}: NIT={by_nit.get(k)!r} CODIGO={by_cod.get(k)!r}")
