#!/usr/bin/env python3
"""Dónde vive el peso del hilo 'Admin' 7ba75950: campos por mensaje (solo lectura)."""
import collections
import io
import json
import sqlite3

import zstandard as zstd

DB = "/home/jk/.local/share/zed/threads/threads.db"
TID_PREFIX = "7ba75950"


def jlen(x):
    return len(json.dumps(x, ensure_ascii=False))


con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
blob = con.execute(
    "SELECT data FROM threads WHERE id LIKE ? || '%'", (TID_PREFIX,)
).fetchone()[0]
with zstd.ZstdDecompressor().stream_reader(io.BytesIO(blob)) as reader:
    obj = json.loads(reader.read().decode("utf-8"))

print("Campos de nivel raíz (tamaño):")
for k, v in obj.items():
    if k == "messages":
        continue
    extra = f" len={len(v)}" if isinstance(v, (list, dict, str)) else ""
    print(f"  {k}: {type(v).__name__} {jlen(v):,}{extra}")

msgs = obj["messages"]
sizes = [jlen(m) for m in msgs]
print("\nMensajes por tamaño: >1M:", sum(1 for s in sizes if s > 1_000_000),
      "| >100k:", sum(1 for s in sizes if s > 100_000))

for i, m in enumerate(msgs):
    if not isinstance(m, dict):
        print(f"\n#{i} RAW {type(m).__name__}: {repr(m)[:80]}")
        continue
    tag = next(iter(m))
    if tag in ("Compaction",):
        print(f"\n#{i} {tag} total={sizes[i]:,}: {json.dumps(m)[:160]}")

order = sorted(range(len(msgs)), key=lambda i: sizes[i], reverse=True)[:4]
for i in order:
    m = msgs[i]
    if not isinstance(m, dict):
        continue
    tag = next(iter(m))
    body = m[tag]
    print(f"\n#{i} {tag} total={sizes[i]:,}")
    if isinstance(body, dict):
        parts = sorted(
            ((jlen(v), k, v) for k, v in body.items()), reverse=True
        )[:8]
        for size, key, value in parts:
            extra = f" len={len(value)}" if isinstance(value, (list, dict, str)) else ""
            print(f"   {key}: {type(value).__name__} {size:,}{extra}")

agg = collections.Counter()
for m in msgs:
    if not isinstance(m, dict):
        continue
    tag = next(iter(m))
    body = m[tag]
    if isinstance(body, dict):
        for k, v in body.items():
            agg[(tag, k)] += jlen(v)
print("\nTotales por campo:")
for (t, k), s in agg.most_common(15):
    print(f"  {t}/{k}: {s:,}")

i = order[0]
m = msgs[i]
tag = next(iter(m))
body = m[tag]
big_key = max(body.items(), key=lambda kv: jlen(kv[1]))[0]
v = body[big_key]
print(f"\nDetalle del campo más grande del mensaje #{i}: {big_key} ({type(v).__name__})")
if isinstance(v, list):
    print("  elementos:", len(v))
    for j, el in enumerate(v[:3]):
        print(f"   [{j}] {type(el).__name__} {jlen(el):,}: {json.dumps(el)[:130]}")
    top = sorted((jlen(el) for el in v), reverse=True)[:3]
    print("  mayores elementos:", [f"{s:,}" for s in top])
elif isinstance(v, dict):
    for k3, v3 in list(v.items())[:8]:
        print(f"   {k3}: {type(v3).__name__} {jlen(v3):,}")
