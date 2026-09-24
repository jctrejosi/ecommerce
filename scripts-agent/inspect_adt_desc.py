#!/usr/bin/env python3
"""Mapea bytes no-cero dentro de descriptores concretos de un .adt."""
import struct
import sys
from pathlib import Path


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def main():
    path = Path(sys.argv[1])
    data = path.read_bytes()
    hdr_len = u32(data, 0x20)
    rec_len = u32(data, 0x24)
    header = data[:hdr_len]
    DESC = 200
    base = 0x190
    n = (hdr_len - base) // DESC
    print(f"hdr_len={hdr_len} rec_len={rec_len} nfields={n}")

    # indices a inspeccionar
    for idx in (0, 1, 2, 3, 4, 5, 242, 243, 244, 294, 295):
        o = base + idx * DESC
        d = header[o:o + DESC]
        name = d[:32].split(b"\0", 1)[0].decode(errors="replace")
        print(f"\n-- field #{idx}  @0x{o:04x} name={name!r}")
        # runs de bytes no-cero
        i = 0
        while i < DESC:
            if d[i] != 0:
                j = i
                while j < DESC and d[j] != 0:
                    j += 1
                run = d[i:j]
                print(f"   +0x{i:02x} ({len(run):2d}B): {run.hex(' ')}")
                i = j
            else:
                i += 1


if __name__ == "__main__":
    main()
