#!/usr/bin/env python3
"""Recorta el hilo 'Admin' (7ba75950...) de la BD de hilos de Zed.

Objetivo: que el próximo request quepa en el límite del modelo DeepSeek
(1.048.576 tokens de contexto) reservando 384.000 para la completion.

- Conserva el mensaje Compaction (handoff) + la cola reciente de mensajes.
- Recorta recursivamente los strings gigantes (tool_results, thinking, etc.)
  preservando la estructura JSON exacta.
- Corta siempre en un mensaje de usuario (sin dejar tool_calls colgando).

Uso:
  python3 scripts-agent/trim-zed-admin-thread.py           # dry-run
  python3 scripts-agent/trim-zed-admin-thread.py --apply   # backup + escritura
"""
import argparse
import io
import json
import sqlite3

import zstandard as zstd

DB = "/home/jk/.local/share/zed/threads/threads.db"
TID_PREFIX = "7ba75950"
BUDGET = 1_000_000  # chars del historial conservado (tras recortes)
MARK = "\u2026[recortado]"


def jlen(x):
    return len(json.dumps(x, ensure_ascii=False))


def trunc(s, n):
    if len(s) <= n:
        return s
    return s[:n] + f"{MARK}({len(s) - n:,} chars)"


def clamp_strings(node, limit):
    """Recorta recursivamente strings largos preservando la estructura."""
    if isinstance(node, str):
        return trunc(node, limit)
    if isinstance(node, list):
        return [clamp_strings(x, limit) for x in node]
    if isinstance(node, dict):
        return {k: clamp_strings(v, limit) for k, v in node.items()}
    return node


def is_user(m):
    return isinstance(m, dict) and next(iter(m.keys())) == "User"


def message_tag(m):
    if isinstance(m, dict):
        return next(iter(m.keys()))
    return f"RAW:{type(m).__name__}"


def clamp_agent_message(m, tr_limit, th_limit):
    tag = message_tag(m)
    if tag != "Agent":
        return m
    body = m["Agent"]
    if not isinstance(body, dict):
        return m
    new = dict(body)

    content = body.get("content")
    if isinstance(content, list):
        nc = []
        for b in content:
            if isinstance(b, dict) and isinstance(b.get("Thinking"), dict):
                th = dict(b["Thinking"])
                if isinstance(th.get("text"), str):
                    th["text"] = trunc(th["text"], th_limit)
                nc.append({"Thinking": th})
            elif isinstance(b, dict) and isinstance(b.get("Text"), str):
                nc.append({"Text": trunc(b["Text"], 6000)})
            elif isinstance(b, dict) and isinstance(b.get("ToolUse"), dict):
                tu = dict(b["ToolUse"])
                if isinstance(tu.get("raw_input"), str):
                    tu["raw_input"] = trunc(tu["raw_input"], 2000)
                if "input" in tu:
                    tu["input"] = clamp_strings(tu["input"], 2000)
                nc.append({"ToolUse": tu})
            else:
                nc.append(b)
        new["content"] = nc

    tr = body.get("tool_results")
    if isinstance(tr, dict):
        new["tool_results"] = {k: clamp_strings(v, tr_limit) for k, v in tr.items()}

    return {"Agent": new}


def summarise(msgs):
    total = sum(jlen(m) for m in msgs)
    tags = {}
    for m in msgs:
        tags[message_tag(m)] = tags.get(message_tag(m), 0) + 1
    return total, tags


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    con = sqlite3.connect(DB, timeout=30)
    rows = con.execute(
        "SELECT id, updated_at, data FROM threads WHERE id LIKE ? || '%'",
        (TID_PREFIX,),
    ).fetchall()
    if len(rows) != 1:
        raise SystemExit(f"Esperaba 1 fila para {TID_PREFIX}, encontré {len(rows)}")
    tid, updated, blob = rows[0]
    with zstd.ZstdDecompressor().stream_reader(io.BytesIO(blob)) as reader:
        obj = json.loads(reader.read().decode("utf-8"))
    msgs = obj["messages"]

    before_chars, before_tags = summarise(msgs)
    print(f"Hilo {tid} (updated {updated})")
    print(f"ANTES: {len(msgs)} mensajes, {before_chars:,} chars, {before_tags}")

    # Estructura del tool_result más grande (solo informe)
    biggest = max(msgs, key=jlen)
    tb = (biggest.get("Agent") or {}) if isinstance(biggest, dict) else {}
    trs = tb.get("tool_results") or {}
    if trs:
        k = max(trs, key=lambda kk: jlen(trs[kk]))
        val = trs[k]
        if isinstance(val, dict):
            print(
                "tool_result más grande:",
                k[:12],
                {k2: f"{jlen(v2):,}" for k2, v2 in list(val.items())[:6]},
            )

    last = len(msgs) - 1
    clamped = [
        clamp_agent_message(
            m,
            tr_limit=8000 if i >= last - 1 else 1000,
            th_limit=4000 if i >= last - 1 else 1500,
        )
        for i, m in enumerate(msgs)
    ]
    sizes = [jlen(m) for m in clamped]

    total = 0
    start = len(msgs)
    for i in range(len(msgs) - 1, -1, -1):
        if total + sizes[i] > BUDGET:
            break
        total += sizes[i]
        start = i
    while start > 0 and not is_user(msgs[start]):
        start -= 1
        total += sizes[start]

    keep = [i for i, m in enumerate(msgs) if message_tag(m) == "Compaction"]
    comp_idx = keep[0] if keep else None
    head = [clamped[comp_idx]] if comp_idx is not None and comp_idx < start else []
    kept = head + clamped[start:]
    after_msgs = len(kept)
    after_chars, after_tags = summarise(kept)

    print(
        f"DESPUÉS: {after_msgs} mensajes, {after_chars:,} chars, {after_tags}"
        f" | corte en #{start} (Compaction #{comp_idx})"
    )
    print(
        f"  ~tokens@2.5ch: {after_chars / 2.5:,.0f}"
        f" | ~tokens@3.5ch: {after_chars / 3.5:,.0f}"
        f"  (límite útil 664.576 con 384k de completion)"
    )
    if start < len(msgs):
        first_kept = msgs[start]
        body = first_kept.get("User") if isinstance(first_kept, dict) else None
        if isinstance(body, dict):
            preview = json.dumps(body.get("content"), ensure_ascii=False)[:160]
            print(f"  primer mensaje conservado (#{start}): {preview}")

    if not args.apply:
        print("\nDRY-RUN: nada escrito. Usa --apply para aplicar.")
        return

    bak = DB + ".bak-pre-trim-20261001"
    dst = sqlite3.connect(bak)
    with dst:
        con.backup(dst)
    dst.close()
    print("\nBackup:", bak)

    obj["messages"] = kept
    new_json = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    comp = zstd.ZstdCompressor(level=3).compress(new_json)
    con.execute("UPDATE threads SET data = ? WHERE id = ?", (comp, tid))
    con.commit()

    check = con.execute(
        "SELECT length(data) FROM threads WHERE id = ?", (tid,)
    ).fetchone()[0]
    print(f"APLICADO: data comprimido {len(blob):,} -> {check:,} bytes")
    con.close()


if __name__ == "__main__":
    main()
