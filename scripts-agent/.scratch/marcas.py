#!/usr/bin/env python3
"""Fill-rate de campos de marca en TIDSAL (por articulo unico)."""
import struct
from collections import Counter
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
f = {}
for i in range((hdr - BASE) // DESC):
    d = data[BASE + i * DESC:BASE + (i + 1) * DESC]
    nm = d[:0x80].split(b"\0", 1)[0].decode(errors="replace")
    if nm:
        f[nm] = (d[0x81], u16(d, 0x83), d[0x87])

seen = set()
vals = {k: Counter() for k in ("INMARCA", "INMARCAP", "INPROVEE", "DESMAR4")}
for i in range(n):
    r = data[hdr + i * rlen: hdr + (i + 1) * rlen]
    t, off, ln = f["INARTIC"]
    art = r[off:off + ln].decode("latin-1").rstrip("\x00 ").strip()
    if art in seen:
        continue
    seen.add(art)
    for k in vals:
        t2, o2, l2 = f[k]
        v = r[o2:o2 + l2].decode("latin-1").rstrip("\x00 ").strip()
        if v:
            vals[k][v] += 1

tot = len(seen)
print(f"articulos unicos: {tot}\n")
for k, c in vals.items():
    print(f"{k}: con valor {sum(c.values())} ({100*sum(c.values())//max(tot,1)}%), "
          f"distintos {len(c)}")
    print("   top:", ", ".join(f"{v!r}x{n}" for v, n in c.most_common(6)))
