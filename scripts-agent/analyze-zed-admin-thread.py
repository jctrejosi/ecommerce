#!/usr/bin/env python3
"""Analiza (solo lectura) los hilos 'Admin' de la BD de Zed.

Uso: python3 scripts-agent/analyze-zed-admin-thread.py
Descomprime los blobs zstd de los candidatos y resume mensajes/tamaños.
"""
import io
import json
import sqlite3

import zstandard as zstd

DB = "/home/jk/.local/share/zed/threads/threads.db"
PREFIXES = ["7ba75950", "d5bd8ef6", "89d421c2"]
EST_CHARS_PER_TOKEN = 3.6


def preview(value, n=140):
    return repr(value)[:n]


con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()
dctx = zstd.ZstdDecompressor()

for prefix in PREFIXES:
    row = cur.execute(
        "SELECT id, summary, updated_at, data FROM threads WHERE id LIKE ? || '%'",
        (prefix,),
    ).fetchone()
    if not row:
        print(f"{prefix}: no encontrado")
        continue

    tid, summary, updated, blob = row
    with dctx.stream_reader(io.BytesIO(blob)) as reader:
        raw = reader.read()
    print("=" * 72)
    print(f"{tid}\n  summary={summary!r}\n  updated={updated}")
    print(f"  comprimido={len(blob):,} B  descomprimido={len(raw):,} B")

    obj = json.loads(raw.decode("utf-8"))
    if not isinstance(obj, dict):
        print("  Raíz no-dict:", type(obj).__name__)
        continue

    print("  claves raíz:", list(obj.keys()))
    msgs = obj.get("messages") or []
    roles = {}
    total = 0
    sized = []
    for i, m in enumerate(msgs):
        s = len(json.dumps(m, ensure_ascii=False))
        total += s
        r = m.get("role", "?") if isinstance(m, dict) else "?"
        roles[r] = roles.get(r, 0) + 1
        sized.append((s, i, r))

    print(f"  mensajes={len(msgs)}  roles={roles}")
    print(f"  chars totales={total:,}  ~tokens={total / EST_CHARS_PER_TOKEN:,.0f}")
    if msgs:
        print("  claves de un mensaje:", list(msgs[-1].keys()))
        sized.sort(reverse=True)
        for s, i, r in sized[:3]:
            body = json.dumps(msgs[i], ensure_ascii=False)
            print(f"  mayor #{i} role={r} {s:,} chars: {body[:100]!r}")

        def brief(m):
            c = m.get("content")
            if isinstance(c, list):
                c = " | ".join(str(b)[:60] for b in c[:2])
            return preview(c, 140)

        print("  primer mensaje:", msgs[0].get("role"), brief(msgs[0]))
        print("  último mensaje:", msgs[-1].get("role"), brief(msgs[-1]))
