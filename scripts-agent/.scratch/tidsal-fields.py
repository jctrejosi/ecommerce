#!/usr/bin/env python3
"""Fill-rate y ejemplos de campos candidatos a complementar productos."""
import struct
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

CAND = ["INNOMBRE3", "INNOMBRE4", "INESTADO", "INGARANTIA", "INMARCAP", "INPRESEN",
        "INPARTE", "INPROTOR", "ININVIMA", "INCUM", "INCATECO", "INCATCOM",
        "INCASACOM", "INANALI", "INUBIC", "INESCA", "INEAN14", "INUMINIDES",
        "INRALI", "INPROVEE", "INIMPCOSTO", "INABC"] + \
       [f"INACTI{i}" for i in range(1, 21)] + \
       [f"DESMAR{i}" for i in range(1, 10)] + \
       ["INALTO", "INANCHO", "INLARGO", "INPESO14", "INLARGO14", "INANCHO14",
        "INALTO14", "INEMBALAJE", "INEMBALAJE2", "INPRESEN"]

seen = set()
examples = {k: [] for k in CAND}
filled = {k: 0 for k in CAND}

for i in range(n):
    r = data[hdr + i * rlen: hdr + (i + 1) * rlen]
    t, off, ln = f["INARTIC"]
    art = r[off:off + ln].decode("latin-1").rstrip("\x00 ").strip()
    if art in seen:
        continue
    seen.add(art)
    for k in CAND:
        if k not in f:
            continue
        tk, ok, lk = f[k]
        raw = r[ok:ok + lk]
        if tk == 0x0A:
            val = struct.unpack("<d", raw)[0]
            ok_val = val != 0
            disp = val
        elif tk == 0x0B:
            val = struct.unpack("<i", raw)[0]
            ok_val = val != 0
            disp = val
        else:
            disp = raw.decode("latin-1").strip("\x00").strip()
            ok_val = disp != ""
        if ok_val:
            filled[k] += 1
            if len(examples[k]) < 2:
                examples[k].append(disp)

tot = len(seen)
print(f"articulos unicos: {tot}\n")
for k in CAND:
    if k not in f:
        continue
    pc = 100 * filled[k] // max(tot, 1)
    ex = " | ".join(str(e)[:40] for e in examples[k])
    print(f"{k:<12} {pc:>3}%  ({filled[k]:>5})  {ex}")
