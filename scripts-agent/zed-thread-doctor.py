#!/usr/bin/env python3
"""Doctor de hilos del agente de Zed (threads.db).

- `list`: salud de los hilos grandes (descomprimido, modelo, tokens estimados).
- `trim`: recorta hilos gigantes preservando la estructura JSON, cortando en
  un mensaje de usuario y conservando el Compaction (y el primer mensaje) como
  anclas de contexto. Acepta varios ids separados por coma.

Uso:
  python3 scripts-agent/zed-thread-doctor.py list
  python3 scripts-agent/zed-thread-doctor.py trim --id 043c9db8 --apply
  python3 scripts-agent/zed-thread-doctor.py trim --id c039c7be,6148dcd7 --apply
"""
import argparse
import io
import json
import os
import re
import sqlite3
import sys

import zstandard as zstd

DB = "/home/jk/.local/share/zed/threads/threads.db"
BAK = DB + ".bak-trim-20261001"
MODEL_RE = re.compile(rb'"model":\s*\{"provider":"[^"]*","model":"([^"]+)"\}')
MARK = "\u2026[recortado]"
CONTEXT_LIMIT = 1_048_576
DEFAULT_COMPLETION = 384_000
DEFAULT_BUDGET = 1_200_000  # chars conservados (aprox. 480k tokens a 2.5 ch/token)


def jlen(x):
    return len(json.dumps(x, ensure_ascii=False))


def trunc(s, n):
    if len(s) <= n:
        return s
    return s[:n] + f"{MARK}({len(s) - n:,} chars)"


def clamp_strings(node, limit):
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


def decompress(blob):
    with zstd.ZstdDecompressor().stream_reader(io.BytesIO(blob)) as reader:
        return reader.read()


def stream_scan(blob):
    """(tamaño descomprimido, modelo) sin cargar todo en memoria."""
    size = 0
    model = None
    carry = b""
    with zstd.ZstdDecompressor().stream_reader(io.BytesIO(blob)) as reader:
        while True:
            chunk = reader.read(1 << 22)
            if not chunk:
                break
            size += len(chunk)
            if model is None:
                window = carry + chunk
                m = MODEL_RE.search(window)
                if m:
                    model = m.group(1).decode("utf-8", "replace")
                carry = window[-160:]
    return size, model


def cmd_list(_args):
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT id, summary, updated_at, length(data), data FROM threads"
    ).fetchall()
    out = []
    for tid, summary, updated, clen, blob in rows:
        if clen < 300_000:
            continue
        size, model = stream_scan(blob)
        est = size / 2.5
        flag = ""
        if est + DEFAULT_COMPLETION > CONTEXT_LIMIT:
            flag = "EXCEDE"
        elif est + DEFAULT_COMPLETION > CONTEXT_LIMIT * 0.8:
            flag = "cerca"
        out.append((size, tid, summary, model, updated, flag))
    out.sort(reverse=True)
    for size, tid, summary, model, updated, flag in out:
        print(
            f"{size:>14,} B  ~{size/2.5:>11,.0f} tok  "
            f"{model or '?':<16} {tid[:8]}  {updated[:19]}  "
            f"{summary[:36]!r} {flag}"
        )
    print(
        f"\n{len(out)} hilos >300KB comprimido | límite contexto {CONTEXT_LIMIT:,} "
        f"| completion reservada {DEFAULT_COMPLETION:,}"
    )


def cmd_status(args):
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    for prefix in [p.strip() for p in args.id.split(",") if p.strip()]:
        rows = con.execute(
            "SELECT id, summary, updated_at, length(data) FROM threads "
            "WHERE id LIKE ? || '%'",
            (prefix,),
        ).fetchall()
        for tid, summary, updated, clen in rows:
            print(f"{tid[:8]}  {clen:>12,} B  {updated[:19]}  {summary[:40]!r}")
        if not rows:
            print(f"{prefix}: no encontrado")


def make_backup_once(con):
    if os.path.exists(BAK):
        print("Backup ya existente, se conserva:", BAK)
        return
    dst = sqlite3.connect(BAK)
    with dst:
        con.backup(dst)
    dst.close()
    print("Backup creado:", BAK)


def trim_one(con, prefix, budget, apply):
    rows = con.execute(
        "SELECT id, updated_at, data FROM threads WHERE id LIKE ? || '%'",
        (prefix,),
    ).fetchall()
    if len(rows) != 1:
        print(f"[{prefix}] Esperaba 1 fila, encontré {len(rows)}. Se omite.")
        return
    tid, updated, blob = rows[0]
    obj = json.loads(decompress(blob).decode("utf-8"))
    msgs = obj["messages"]
    before = sum(jlen(m) for m in msgs)
    print(f"\nHilo {tid} (updated {updated})")
    print(f"ANTES: {len(msgs)} mensajes, {before:,} chars")

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
        if total + sizes[i] > budget:
            break
        total += sizes[i]
        start = i
    while start > 0 and not is_user(msgs[start]):
        start -= 1
        total += sizes[start]
    if start >= len(msgs):
        start = max(0, len(msgs) - 1)

    comp_idx = next(
        (i for i, m in enumerate(msgs) if message_tag(m) == "Compaction"), None
    )
    first_user = next((i for i, m in enumerate(msgs) if is_user(m)), None)

    head = []
    if (
        first_user is not None
        and first_user < start
        and jlen(clamped[first_user]) <= 20_000
    ):
        head.append(clamped[first_user])
    if comp_idx is not None and comp_idx < start:
        head.append(clamped[comp_idx])

    kept = head + clamped[start:]
    after = sum(jlen(m) for m in kept)
    print(
        f"DESPUÉS: {len(kept)} mensajes, {after:,} chars | corte #{start} "
        f"| anclas: primer_user={first_user} compaction={comp_idx}"
    )
    print(
        f"  ~tokens@2.5ch: {after / 2.5:,.0f} | ~tokens@3.5ch: {after / 3.5:,.0f}"
        f"  (presupuesto útil {CONTEXT_LIMIT - DEFAULT_COMPLETION:,})"
    )
    if start < len(msgs):
        body = msgs[start].get("User") if isinstance(msgs[start], dict) else None
        if isinstance(body, dict):
            print(
                "  primer mensaje del tramo:",
                json.dumps(body.get("content"), ensure_ascii=False)[:140],
            )

    if not apply:
        print("DRY-RUN: nada escrito.")
        return

    obj["messages"] = kept
    new_json = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    comp = zstd.ZstdCompressor(level=3).compress(new_json)
    con.execute("UPDATE threads SET data = ? WHERE id = ?", (comp, tid))
    con.commit()
    check = con.execute(
        "SELECT length(data) FROM threads WHERE id = ?", (tid,)
    ).fetchone()[0]
    print(f"APLICADO: data comprimido {len(blob):,} -> {check:,} bytes")


def cmd_trim(args):
    prefixes = [p.strip() for p in args.id.split(",") if p.strip()]
    con = sqlite3.connect(DB, timeout=60)
    if args.apply:
        make_backup_once(con)
    for prefix in prefixes:
        trim_one(con, prefix, args.budget, args.apply)
    con.close()


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list")
    p_list.set_defaults(func=cmd_list)

    p_status = sub.add_parser("status")
    p_status.add_argument("--id", required=True)
    p_status.set_defaults(func=cmd_status)

    p_trim = sub.add_parser("trim")
    p_trim.add_argument("--id", required=True, help="prefijo(s) separados por coma")
    p_trim.add_argument("--budget", type=int, default=DEFAULT_BUDGET)
    p_trim.add_argument("--apply", action="store_true")
    p_trim.set_defaults(func=cmd_trim)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
