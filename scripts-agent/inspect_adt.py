#!/usr/bin/env python3
"""Inspecciona el header de una tabla ADS (.adt): estructura general y
candidatos a descriptores de campo (nombre + metadatos binarios).

Uso:
    python3 scripts-agent/inspect_adt.py db/ADD_CONTAB/TIDSAL.adt
"""
import re
import struct
import sys
from pathlib import Path


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def main():
    path = Path(sys.argv[1])
    data = path.read_bytes()
    print(f"== {path.name}  ({len(data):,} bytes) ==")
    print("signature:", data[0:16])
    for off in range(0x10, 0x60, 2):
        pass
    # cabecera conocida
    print(f"0x14 u32 = {u32(data, 0x14)}")
    print(f"0x18 u32 (recordCount?) = {u32(data, 0x18):,}")
    print(f"0x20 u32 (headerLen?)   = {u32(data, 0x20):,}")
    print(f"0x24 u32 (recordLen?)   = {u32(data, 0x24):,}")
    hdr_len = u32(data, 0x20)
    rec_len = u32(data, 0x24)
    rec_count = u32(data, 0x18)
    print(f"check: recCount*recLen + headerLen = "
          f"{rec_count * rec_len + hdr_len:,}  (file={len(data):,})")

    header = data[:hdr_len] if 0 < hdr_len <= len(data) else data[:0x40000]

    # nombres de campo: secuencias A-Z0-9_ de 2+ chars
    pat = re.compile(rb"[A-Z_][A-Z0-9_]{1,}")
    print("\n== Candidatos a nombre de campo (offset, nombre) ==")
    names = []
    for m in pat.finditer(header):
        s = m.group().decode()
        if s in ("Advantage", "Table"):
            continue
        names.append((m.start(), s))
    for off, s in names:
        print(f"  0x{off:04x}  {s}")

    # Descriptor de 200 bytes: imprime la zona de metadatos (offset 0x60..0xA0)
    print("\n== Metadatos dentro de cada descriptor (200B) [0x60..0xA0] ==")
    for off, s in names:
        meta = header[off + 0x60:off + 0xA0]
        print(f"  0x{off:04x} {s:<14} {meta.hex(' ')}")
    print(f"\ntotal candidatos: {len(names)}")


if __name__ == "__main__":
    main()
