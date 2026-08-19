#!/usr/bin/env python3
"""Verifica el camino real (sin driver en Linux): debe dar 503 con mensaje claro."""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
VENV_PY = os.path.join(HERE, "venv", "bin", "python")
PORT = 8124
BASE = f"http://127.0.0.1:{PORT}"

env = dict(os.environ)  # SIN ADS_DEMO
proc = subprocess.Popen(
    [VENV_PY, "-m", "uvicorn", "api.main:app", "--port", str(PORT)],
    cwd=HERE,
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
)

try:
    for _ in range(40):
        try:
            urllib.request.urlopen(BASE + "/", timeout=5)
            break
        except urllib.error.URLError:
            time.sleep(0.5)
    try:
        with urllib.request.urlopen(BASE + "/provee", timeout=15) as r:
            print("GET /provee -> 200 (inesperado)")
    except urllib.error.HTTPError as e:
        print(f"GET /provee -> {e.code}")
        print("   detail:", json.loads(e.read())["detail"])
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
