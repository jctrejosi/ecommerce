#!/usr/bin/env python3
"""Muestra una fila de ejemplo de TIDSAL con campos de clasificacion."""
import struct
import sys
from pathlib import Path

BASE = 0x190
DESC = 200


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


data = Path(sys.argv[1]).read_bytes()
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

WANT = ["INSUC", "INBODEGA", "INARTIC", "INEAN", "INPARTE", "INNOMBRE",
        "INUNIDAD", "INPROVEE", "INTIPO", "INTIPINV", "INVRVENTA1",
        "INVRVENTA0", "INTIMP", "INIMPC", "INMINIMO", "INMAXIMO",
        "INVRULTC", "INUBIC", "INMARCA", "INACTIVO", "INWEB", "INSALDO00",
        "INSALDOWEB", "INCATE", "INCATECO", "INCATCOM", "INCASACOM",
        "INFAMIS", "INACTI1", "INACTI2", "INACTI3", "ETIDIG"]


def read(rec, name):
    t, off, ln = fields[name]
    raw = rec[off:off + ln]
    if t == 0x0A:
        return struct.unpack("<d", raw)[0]
    if t == 0x0B:
        return struct.unpack("<i", raw)[0]
    return raw.decode("latin-1").rstrip()


def record(i):
    o = hdr_len + i * rec_len
    return data[o:o + rec_len]


print(f"{nrec} registros")
for i in range(2):
    print(f"--- fila {i} ---")
    r = record(i)
    for w in WANT:
        if w in fields:
            print(f"   {w:<10}= {read(r, w)!r}")
