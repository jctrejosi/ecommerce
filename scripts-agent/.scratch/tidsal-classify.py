#!/usr/bin/env python3
"""Cruza los codigos de clasificacion de TIDSAL con el arbol TIDTAB."""
import struct
from collections import Counter
from pathlib import Path

BASE = 0x190
DESC = 200


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


class T:
    def __init__(self, path):
        data = Path(path).read_bytes()
        self.data = data
        self.hdr = u32(data, 0x20)
        self.rlen = u32(data, 0x24)
        self.n = u32(data, 0x18)
        header = data[:self.hdr]
        self.f = {}
        for i in range((self.hdr - BASE) // DESC):
            d = header[BASE + i * DESC:BASE + (i + 1) * DESC]
            nm = d[:0x80].split(b"\0", 1)[0].decode(errors="replace")
            if nm:
                self.f[nm] = (d[0x81], u16(d, 0x83), d[0x87])

    def raw(self, i, nm):
        _, off, ln = self.f[nm]
        o = self.hdr + i * self.rlen + off
        return self.data[o:o + ln]

    def ch(self, i, nm):
        return self.raw(i, nm).decode("latin-1").rstrip("\x00 ").strip()

    def num(self, i, nm):
        return struct.unpack("<d", self.raw(i, nm))[0]


tidsal = T("db/ADD_CONTAB/TIDSAL.adt")
tidtab = T("db/ADD_CONTAB/TIDTAB.ADT")

codes = {tidtab.ch(i, "CTABCOD"): tidtab.ch(i, "CTABDES")
         for i in range(tidtab.n)}
parents = {tidtab.ch(i, "CTABCOD"): tidtab.ch(i, "CTABCOD1")
           for i in range(tidtab.n)}

for field in ("INCATE", "INTIPO"):
    vals = Counter()
    for i in range(tidsal.n):
        vals[tidsal.ch(i, field)] += 1
    found = [v for v in vals if v in codes]
    print(f"\n== {field} ==")
    print(f"  distintos: {len(vals)}   encontrados en TIDTAB: {len(found)}")
    for v, c in vals.most_common(6):
        chain = []
        cur = v
        while cur and cur in codes:
            chain.append(f"{cur}={codes[cur]}")
            cur = parents.get(cur, "")
            if len(chain) > 6:
                break
        print(f"  {v!r} x{c}: " + " <- ".join(chain))
