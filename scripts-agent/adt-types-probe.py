#!/usr/bin/env python3
"""Muestra valores crudos (hex+ascii) de campos de ejemplo por cada tipo,
leyendo los primeros registros de un .adt. Sirve para confirmar el mapeo
codigo-de-tipo -> tipo real (char / numeric / date / logical ...)."""
import struct
import sys
from collections import defaultdict
from pathlib import Path

DESC = 200
BASE = 0x190


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def main():
    path = Path(sys.argv[1])
    data = path.read_bytes()
    hdr_len = u32(data, 0x20)
    rec_len = u32(data, 0x24)
    rec_count = u32(data, 0x18)
    header = data[:hdr_len]
    nfields = (hdr_len - BASE) // DESC

    fields = []
    for i in range(nfields):
        o = BASE + i * DESC
        d = header[o:o + DESC]
        name = d[:0x80].split(b"\0", 1)[0].decode(errors="replace")
        if not name:
            continue
        fields.append((name, d[0x81], u16(d, 0x83), d[0x87], d[0x88]))

    # primer registro
    rec0 = data[hdr_len:hdr_len + rec_len]
    print(f"records={rec_count} rec_len={rec_len} nfields={len(fields)}")

    seen = defaultdict(list)
    for name, tcode, off, ln, dec in fields:
        seen[tcode].append((name, off, ln, dec))

    for tcode in sorted(seen):
        print(f"\n### tipo 0x{tcode:02x}  ({len(seen[tcode])} campos)")
        for name, off, ln, dec in seen[tcode][:6]:
            raw = rec0[off:off + ln]
            printable = all(0x20 <= c < 0x7f for c in raw) if raw else False
            dv = struct.unpack("<d", raw)[0] if ln == 8 and len(raw) == 8 else None
            print(f"   {name:<12} off={off:5d} len={ln:3d} dec={dec} "
                  f"hex={raw.hex(' '):<26} ascii={raw!r} "
                  f"{'PRINTABLE' if printable else ''}"
                  f"{f' double={dv!r}' if dv is not None else ''}")


if __name__ == "__main__":
    main()
