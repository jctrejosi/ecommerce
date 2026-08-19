#!/usr/bin/env python3
"""Smoke test de la API Publidata PROVEE (modo demo)."""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
VENV_PY = os.path.join(HERE, "venv", "bin", "python")
PORT = 8123
BASE = f"http://127.0.0.1:{PORT}"

env = dict(os.environ, ADS_DEMO="1")
proc = subprocess.Popen(
    [VENV_PY, "-m", "uvicorn", "api.main:app", "--port", str(PORT)],
    cwd=HERE,
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
)


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return r.status, r.read()


try:
    for _ in range(40):
        try:
            status, body = get("/")
            break
        except urllib.error.URLError:
            time.sleep(0.5)
    else:
        print("NO LEVANTÓ")
        sys.exit(1)

    print(f"GET /                 -> {status}")
    print("   ", json.loads(body))

    status, body = get("/provee?limit=3")
    d = json.loads(body)
    print(f"GET /provee?limit=3   -> {status} total={d['total']} devueltos={d['devueltos']}")
    print("    primer fila:", d["fila"][0])

    status, body = get("/provee/P0001")
    d = json.loads(body)
    print(f"GET /provee/P0001     -> {status}")
    print("    fila:", d["fila"])

    status, body = get("/provee/count")
    print(f"GET /provee/count     -> {status} {json.loads(body)}")

    status, body = get("/provee/meta")
    print(f"GET /provee/meta      -> {status} {json.loads(body)}")

    try:
        get("/provee/NOEXISTE")
        print("GET /provee/NOEXISTE  -> 200 (inesperado!)")
    except urllib.error.HTTPError as e:
        print(f"GET /provee/NOEXISTE  -> {e.code} (404 esperado)")

    status, body = get("/openapi.json")
    paths = list(json.loads(body)["paths"].keys())
    print(f"GET /openapi.json     -> {status} paths={paths}")

    status, body = get("/docs")
    print(f"GET /docs (swagger)   -> {status} bytes={len(body)}")
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
