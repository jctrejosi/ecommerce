#!/usr/bin/env python3
"""Muestra la region de 'comentario' de los descriptores de campo de un .adt.

El descriptor mide 200 bytes: nombre en +0x00..0x80, y posible comentario/desc
en la cola (+0x89..0xC8). Imprime nombre -> ascii imprimible de la cola.
"""
import struct
import sys
from pathlib import Path

DESC = 200
BASE = 0x190


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def printable(b: bytes) -> str:
    return "".join(chr(c) if 32 <= c < 127 else "." for c in b)


def main():
    data = Path(sys.argv[1]).read_bytes()
    hdr_len = u32(data, 0x20)
    header = data[:hdr_len]
    n = (hdr_len - BASE) // DESC
    for i in range(n):
        d = header[BASE + i * DESC:BASE + (i + 1) * DESC]
        name = d[:0x80].split(b"\0", 1)[0].decode(errors="replace")
        if not name:
            continue
        tail = d[0x89:DESC]
        text = printable(tail).strip(".")
        print(f"{name:14s} | {text}")


if __name__ == "__main__":
    main()
