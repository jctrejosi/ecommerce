#!/usr/bin/env python3
"""Extrae el diccionario de columnas de una tabla ADS/ADT.

Layout deducido (TIDSAL.adt, Advantage Table):
  header @0x18 u32 recordCount, @0x20 u32 headerLen, @0x24 u32 recordLen
  descriptores de campo: desde 0x190, tamano fijo 200 bytes (0xC8)
    +0x00  nombre (ASCII, null-terminado, hasta 0x80)
    +0x81  u8   tipo de dato
    +0x83  u16  offset dentro del registro (LE)
    +0x87  u8   longitud en bytes
    +0x88  u8   decimales

Uso:
    python3 scripts-agent/adt-dict.py db/ADD_CONTAB/TIDSAL.adt [salida.md]
"""
import struct
import sys
from collections import defaultdict
from pathlib import Path

DESC = 200
BASE = 0x190

# Codigos de tipo confirmados leyendo valores reales del primer registro:
#   0x01 logical (1B, 'T'/'F')
#   0x04 char    (ASCII, relleno con espacios)
#   0x0A double  (numerico IEEE de 8B)
#   0x0B int32   (entero de 4B; las fechas van como entero YYYYMMDD)
#   0x0C binary  (2B binario/short)
TYPE_NAMES = {
    0x01: "logico",
    0x04: "char",
    0x0A: "numeric(8B)",
    0x0B: "int32",
    0x0C: "bin(2B)",
}


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def main():
    path = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    data = path.read_bytes()
    hdr_len = u32(data, 0x20)
    rec_len = u32(data, 0x24)
    rec_count = u32(data, 0x18)
    header = data[:hdr_len]
    nfields = (hdr_len - BASE) // DESC

    rows = []
    for i in range(nfields):
        o = BASE + i * DESC
        d = header[o:o + DESC]
        name = d[:0x80].split(b"\0", 1)[0].decode(errors="replace")
        if not name:
            continue
        tcode = d[0x81]
        offset = u16(d, 0x83)
        length = d[0x87]
        decimals = d[0x88]
        rows.append((i, name, tcode, offset, length, decimals))

    print(f"== {path.name} ==")
    print(f"registros : {rec_count:,}")
    print(f"headerLen : {hdr_len:,}")
    print(f"recordLen : {rec_len:,}")
    print(f"columnas  : {len(rows)}")
    # validacion: offsets contiguos desde el primero
    first = rows[0][3]
    last = rows[-1]
    print(f"primer offset={first}  ultimo={last[3]} + len={last[4]} = "
          f"{last[3] + last[4]}  (recordLen={rec_len})")

    print("\n== Tipos de dato presentes ==")
    by_type = defaultdict(list)
    for r in rows:
        by_type[r[2]].append(r[1])
    for tcode, names in sorted(by_type.items()):
        label = TYPE_NAMES.get(tcode, "?")
        print(f"  tipo 0x{tcode:02x} ({label:12s}) x{len(names):3d}  "
              f"ej: {', '.join(names[:5])}")

    # salida markdown con el diccionario
    lines = [
        f"# Diccionario de columnas — {path.stem}",
        "",
        f"- Registros: {rec_count:,}",
        f"- Longitud de registro: {rec_len} bytes",
        f"- Columnas: {len(rows)}",
        "",
        "| # | Columna | Tipo | Bytes | Dec | Offset |",
        "|---|---------|------|-------|-----|--------|",
    ]
    for i, name, tcode, offset, length, decimals in rows:
        label = TYPE_NAMES.get(tcode, f"?0x{tcode:02x}")
        dec = decimals if decimals else ""
        lines.append(f"| {i} | `{name}` | {label} | {length} | {dec} | {offset} |")
    md = "\n".join(lines) + "\n"
    if out:
        out.write_text(md, encoding="utf-8")
        print(f"\nDiccionario escrito en {out} ({len(rows)} columnas)")
    else:
        print("\n" + md)


if __name__ == "__main__":
    main()
