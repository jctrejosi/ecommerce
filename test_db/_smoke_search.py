#!/usr/bin/env python3
"""Prueba el endpoint de búsqueda del backend (con datos reparados + unaccent)."""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # raíz del proyecto (mercaldas-ecommerce)
BASE = "http://localhost:3000"

env = dict(os.environ)
env["DATABASE_URL"] = "postgresql://postgres:postgres@localhost:5432/ecommerce"

dotenvx = os.path.join(ROOT, "backend", "node_modules", ".bin", "dotenvx")
node = os.path.join(ROOT, "backend", "dist", "src", "main.js")

proc = subprocess.Popen(
    [dotenvx, "run", "-f", os.path.join(ROOT, "backend", ".env.development.local"),
     "--", "node", node],
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
)

def post_search(term):
    body = json.dumps({"search": term, "limit": 5}).encode()
    req = urllib.request.Request(
        BASE + "/catalog/products", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())

try:
    up = False
    for _ in range(60):
        if proc.poll() is not None:
            out = proc.stdout.read().decode(errors="replace")
            print("BACKEND MURIÓ:"); print(out[-2000:]); sys.exit(1)
        try:
            with urllib.request.urlopen(BASE + "/api-status", timeout=3) as r:
                if r.status == 200:
                    up = True
                    break
        except urllib.error.URLError:
            time.sleep(1)
    if not up:
        print("Backend no levantó en 60s"); sys.exit(2)

    print("✅ Backend arriba")
    for term in ["bretaña", "bretana", "piña", "cafe"]:
        try:
            d = post_search(term)
            print(f"\nsearch {term!r} -> {len(d)} resultados")
            for p in d[:4]:
                print("   -", p["name"])
        except Exception as e:
            print(f"\nsearch {term!r} -> ERROR {e}")
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
