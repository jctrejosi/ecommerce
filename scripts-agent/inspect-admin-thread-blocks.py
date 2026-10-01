#!/usr/bin/env python3
"""Inspecciona la estructura interna del hilo 'Admin' 7ba75950 (solo lectura)."""
import collections
import io
import json
import sqlite3

import zstandard as zstd

DB = "/home/jk/.local/share/zed/threads/threads.db"
TID_PREFIX = "7ba75950"


def block_tag(b):
    if not isinstance(b, dict):
        return type(b).__name__
    return next(iter(b.keys()), "?")


con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()
blob = cur.execute(
    "SELECT data FROM threads WHERE id LIKE ? || '%'", (TID_PREFIX,)
).fetchone()[0]
with zstd.ZstdDecompressor().stream_reader(io.BytesIO(blob)) as reader:
    obj = json.loads(reader.read().decode("utf-8"))

for key in (
    "model",
    "profile",
    "version",
    "thinking_enabled",
    "thinking_effort",
    "speed",
):
    if key in obj:
        print(f"{key}: {json.dumps(obj[key])[:160]}")

for key in ("cumulative_token_usage", "request_token_usage"):
    v = obj.get(key)
    print(f"\n{key}: {type(v).__name__}", end="")
    if isinstance(v, list):
        print(f" len={len(v)}")
        print("  últimos 3:", json.dumps(v[-3:])[:280])
    elif isinstance(v, dict):
        print(" keys:", list(v.keys())[:12])
        print("  ", json.dumps(v)[:280])
    else:
        print(f" {str(v)[:200]}")

rtu = obj.get("request_token_usage") or {}
if isinstance(rtu, dict):
    items = [(k, v) for k, v in rtu.items() if isinstance(v, dict)]
    top = sorted(items, key=lambda kv: kv[1].get("input_tokens", 0), reverse=True)[:3]
    print("\nrequest_token_usage entradas:", len(items))
    for k, v in top:
        print(
            f"  top input={v.get('input_tokens', 0):,}"
            f" output={v.get('output_tokens', 0):,} id={k[:8]}"
        )

ds = obj.get("detailed_summary")
print("\ndetailed_summary:", type(ds).__name__, f"len={len(ds)}" if ds else "", repr(ds)[:90] if ds else "")

msgs = obj["messages"]
agg = collections.Counter()
tags = collections.Counter()
raw_samples = []
for m in msgs:
    if not isinstance(m, dict):
        tags["RAW:" + type(m).__name__] += 1
        if len(raw_samples) < 3:
            raw_samples.append(repr(m)[:110])
        continue
    tag = next(iter(m.keys()))
    tags[tag] += 1
    body = m[tag]
    content = body.get("content") if isinstance(body, dict) else None
    if isinstance(content, list):
        for b in content:
            agg[(tag, block_tag(b))] += len(json.dumps(b, ensure_ascii=False))
print("\ntipos de mensaje:", dict(tags))
for s in raw_samples:
    print("  muestra raw:", s)
print("\nchars por (mensaje, bloque):")
for (t, b), s in agg.most_common(12):
    print(f"  {t}/{b}: {s:,}")

print("\nÚltimos 4 mensajes:")
for i in range(max(0, len(msgs) - 4), len(msgs)):
    m = msgs[i]
    if not isinstance(m, dict):
        print(f"  #{i} RAW {type(m).__name__}: {repr(m)[:100]}")
        continue
    tag = next(iter(m.keys()))
    body = m[tag]
    parts = [
        f"{block_tag(b)}={len(json.dumps(b, ensure_ascii=False)):,}"
        for b in (body.get("content") or [])
    ]
    print(
        f"  #{i} {tag} ({len(json.dumps(m, ensure_ascii=False)):,} chars)"
        f" [{', '.join(parts)}]"
    )


def sample(kind):
    for m in msgs:
        if not isinstance(m, dict):
            continue
        tag = next(iter(m.keys()))
        body = m[tag]
        if not isinstance(body, dict):
            continue
        for b in body.get("content") or []:
            if block_tag(b) == kind and len(json.dumps(b)) > 2000:
                inner = b[kind]
                keys = list(inner.keys()) if isinstance(inner, dict) else type(inner).__name__
                print(f"\nmuestra {kind}: claves={keys}")
                print("  ", json.dumps(b)[:260])
                return


for kind in ("Thinking", "ToolResult", "ToolUse"):
    sample(kind)
