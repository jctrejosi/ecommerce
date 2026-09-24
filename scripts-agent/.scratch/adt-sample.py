#!/usr/bin/env python3
"""Muestra N filas de un .adt para un conjunto de columnas.

Uso:
    python3 scripts-agent/.scratch/adt-sample.py TABLA.adt N COL1,COL2,...
"""
import struct
import sys
from pathlib import Path

BASE = 0x190
DESC = 200


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


path = Path(sys.argv[1])
n = int(sys.argv[2])
want = sys.argv[3].split(",")

data = path.read_bytes()
hdr_len = u32(data, 0x20)
rec_len = u32(data, 0x24)
nrec = u32(data, 0x18)
header = data[:hdr_len]
fields = {}
for i in range((hdr_len - BASE) // DESC):
    d = header[BASE + i * DESC:BASE + (i + 1) * DESC]
    name = d[:0x80].split(b"\0", 1)[0].decode(errors="replace")
    if name:
        fields[name] = (d[0x81], u16(d, 0x83), d[0x87])


def read(rec, name):
    t, off, ln = fields[name]
    raw = rec[off:off + ln]
    if t == 0x0A:
        return struct.unpack("<d", raw)[0]
    if t == 0x0B:
        return struct.unpack("<i", raw)[0]
    return raw.decode("latin-1").rstrip()


print(f"{path.name}: {nrec} registros, cols={len(fields)}")
for i in range(min(n, nrec)):
    o = hdr_len + i * rec_len
    r = data[o:o + rec_len]
    vals = {w: read(r, w) for w in want if w in fields}
    print(f"  {i}: " + ", ".join(f"{k}={v!r}" for k, v in vals.items()))
