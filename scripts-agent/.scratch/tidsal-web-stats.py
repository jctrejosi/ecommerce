#!/usr/bin/env python3
"""Cuantos productos unicos hay segun INWEB/INACTIVO (a nivel global)."""
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


artic_web = set()
artic_web_act = set()
artic_act = set()
artic_all = set()
web_branches = defaultdict(set)
for i in range(n):
    rec = data[hdr + i * rlen: hdr + (i + 1) * rlen]
    art = ch(rec, "INARTIC")
    web = ch(rec, "INWEB") == "T"
    act = ch(rec, "INACTIVO") == "A"
    artic_all.add(art)
    if act:
        artic_act.add(art)
    if web:
        artic_web.add(art)
        web_branches[art].add(int(struct.unpack(
            "<d", rec[f["INSUC"][1]:f["INSUC"][1] + 8])[0]))
    if web and act:
        artic_web_act.add(art)

en_una = sum(1 for a, s in web_branches.items() if len(s) == 1)
en_varias = sum(1 for a, s in web_branches.items() if len(s) > 1)
print(f"productos totales (distintos)      : {len(artic_all)}")
print(f"productos activos (INACTIVO='A')   : {len(artic_act)}")
print(f"productos con INWEB='T' (cualquier suc): {len(artic_web)}")
print(f"  de esos, activos                 : {len(artic_web_act)}")
print(f"  INWEB='T' en 1 sola sucursal     : {en_una}")
print(f"  INWEB='T' en 2+ sucursales       : {en_varias}")
