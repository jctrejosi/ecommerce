#!/usr/bin/env python3
"""Resumen de TIDSAL.adt orientado a la carga 'productos por sucursal'.

Decodifica los campos clave de todos los registros y devuelve SOLO un resumen:
- distribucion de INSUC (sucursal), INBODEGA, INACTIVO, INWEB
- conteos de productos
- una muestra corta de filas

Uso:
    python3 scripts-agent/adt-summary.py db/ADD_CONTAB/TIDSAL.adt
"""
import struct
import sys
from collections import Counter
from pathlib import Path

BASE = 0x190
DESC = 200


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


class Table:
    def __init__(self, data):
        self.data = data
        self.hdr_len = u32(data, 0x20)
        self.rec_len = u32(data, 0x24)
        self.nrec = u32(data, 0x18)
        header = data[:self.hdr_len]
        self.fields = {}
        n = (self.hdr_len - BASE) // DESC
        for i in range(n):
            o = BASE + i * DESC
            d = header[o:o + DESC]
            name = d[:0x80].split(b"\0", 1)[0].decode()
            if name:
                self.fields[name] = (d[0x81], u16(d, 0x83), d[0x87])

    def record(self, i):
        o = self.hdr_len + i * self.rec_len
        return self.data[o:o + self.rec_len]

    def raw(self, rec, name):
        _, off, ln = self.fields[name]
        return rec[off:off + ln]

    def char(self, rec, name):
        return self.raw(rec, name).decode("latin-1").rstrip()

    def double(self, rec, name):
        return struct.unpack("<d", self.raw(rec, name))[0]

    def int32(self, rec, name):
        return struct.unpack("<i", self.raw(rec, name))[0]

    def logical(self, rec, name):
        v = self.raw(rec, name)[:1]
        return {b"T": True, b"F": False}.get(v, None)


def main():
    path = Path(sys.argv[1])
    t = Table(path.read_bytes())
    print(f"{path.name}: {t.nrec:,} registros, {len(t.fields)} columnas\n")

    suc = Counter()
    bodega = Counter()
    activo = Counter()
    web = Counter()
    con_stock = 0
    con_saldoweb = 0
    seen_artic = set()
    sample = []
    for i in range(t.nrec):
        r = t.record(i)
        s = int(t.double(r, "INSUC"))
        suc[s] += 1
        bodega[(s, t.char(r, "INBODEGA"))] += 1
        activo[t.char(r, "INACTIVO")] += 1
        web[t.logical(r, "INWEB")] += 1
        if t.double(r, "INSALDO00") != 0:
            con_stock += 1
        if t.double(r, "INSALDOWEB") != 0:
            con_saldoweb += 1
        seen_artic.add(t.char(r, "INARTIC"))
        if i < 3:
            sample.append({
                "INSUC": s,
                "INBODEGA": t.char(r, "INBODEGA"),
                "INARTIC": t.char(r, "INARTIC"),
                "INEAN": t.char(r, "INEAN"),
                "INNOMBRE": t.char(r, "INNOMBRE")[:40],
                "INMARCA": t.char(r, "INMARCA"),
                "INUNIDAD": t.char(r, "INUNIDAD"),
                "INSALDO00": t.double(r, "INSALDO00"),
                "INSALDOWEB": t.double(r, "INSALDOWEB"),
                "INWEB": t.logical(r, "INWEB"),
                "INACTIVO": t.char(r, "INACTIVO"),
                "INCATECO": t.char(r, "INCATECO"),
                "INTIPO": t.char(r, "INTIPO"),
            })

    print("== INSUC (sucursal) -> filas ==")
    for k, v in sorted(suc.items()):
        print(f"   sucursal {k}: {v:,} filas")
    print(f"\nINARTIC distintos (productos): {len(seen_artic):,}")
    print(f"filas con INSALDO00 != 0     : {con_stock:,}")
    print(f"filas con INSALDOWEB != 0    : {con_saldoweb:,}")

    print("\n== Bodega por sucursal (top) ==")
    for (s, b), v in sorted(bodega.items())[:20]:
        print(f"   suc {s} / bodega {b!r}: {v:,}")

    print("\n== INACTIVO ==", dict(activo))
    print("== INWEB ==", dict(web))

    print("\n== Muestra (primeras 3 filas) ==")
    for row in sample:
        for k, v in row.items():
            print(f"   {k:<11}= {v!r}")
        print("   ---")


if __name__ == "__main__":
    main()
