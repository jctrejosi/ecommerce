#!/usr/bin/env python3
"""Inspección (solo lectura) de la BD de hilos del agente de Zed.

Uso: python3 scripts-agent/inspect-zed-thread.py
No escribe nada; solo resume tamaños, títulos y estructura del hilo más grande.
"""
import json
import sqlite3

DB = "/home/jk/.local/share/zed/threads/threads.db"


def preview(value, n=80):
    return repr(value)[:n]


con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()

print("data_type distribution:")
for dt, n in cur.execute(
    "SELECT data_type, COUNT(*) FROM threads GROUP BY data_type"
):
    print(f"  {dt}: {n}")

print("\nTop 8 hilos por tamaño (bytes de data):")
for tid, summary, updated, ln in cur.execute(
    "SELECT id, summary, updated_at, length(data) FROM threads "
    "ORDER BY length(data) DESC LIMIT 8"
):
    print(f"  {ln:>10,}  {updated}  {tid[:8]}  {summary[:70]!r}")

print("\nHilos cuyo summary menciona 'admin':")
for tid, summary, ln in cur.execute(
    "SELECT id, summary, length(data) FROM threads "
    "WHERE summary LIKE '%admin%' ORDER BY length(data) DESC LIMIT 10"
):
    print(f"  {ln:>10,}  {tid[:8]}  {summary[:70]!r}")

row = cur.execute(
    "SELECT id, data_type, data FROM threads ORDER BY length(data) DESC LIMIT 1"
).fetchone()
print("\nHilo más grande:", row[0])
print("data_type:", row[1], "| head bytes:", row[2][:24].hex())

try:
    obj = json.loads(row[2].decode("utf-8"))
except Exception as exc:  # noqa: BLE001
    print("No es JSON UTF-8:", type(exc).__name__, str(exc)[:120])
    raise SystemExit(0)

print("Tipo raíz:", type(obj).__name__)
if isinstance(obj, dict):
    print("Claves raíz:", list(obj.keys())[:30])
    for key in ("messages", "title", "summary"):
        if key in obj:
            val = obj[key]
            print(f"  {key}: {type(val).__name__}", end="")
            if isinstance(val, list):
                print(f" ({len(val)} items)")
            elif isinstance(val, str):
                print(f" len={len(val)} {preview(val)}")
            else:
                print()
    msgs = obj.get("messages")
    if isinstance(msgs, list):
        roles = {}
        total = 0
        sizes = []
        for i, m in enumerate(msgs):
            size = len(json.dumps(m, ensure_ascii=False))
            total += size
            role = m.get("role") if isinstance(m, dict) else "?"
            roles[role] = roles.get(role, 0) + 1
            sizes.append((size, i, role))
        print("Total chars en messages:", f"{total:,}")
        print("Roles:", roles)
        sizes.sort(reverse=True)
        print("5 mensajes más grandes:")
        for size, i, role in sizes[:5]:
            m = msgs[i]
            head = json.dumps(m, ensure_ascii=False)
            print(f"  #{i} {role} {size:,} chars: {head[:110]!r}")
