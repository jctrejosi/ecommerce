#!/usr/bin/env python3
"""Mide el y del texto del banner 'Buscando el servidor…' (debe quedar bajo la barra de estado)."""
import re
import subprocess
import sys
import time

ADB = "/home/jk/Android/Sdk/platform-tools/adb"
SERIAL = "dd03888"
PKG = "com.dsi.pickingapp"
TEXTS = ("Buscando el servidor en la red", "Sin conexión con el servidor")


def sh(*a, timeout=90):
    return subprocess.run([ADB, "-s", SERIAL, *a], capture_output=True, text=True, timeout=timeout).stdout


def dump():
    sh("shell", "uiautomator", "dump", "/sdcard/b.xml")
    return sh("shell", "cat", "/sdcard/b.xml")


def center(b):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", b))
    return (x1 + x2) // 2, (y1 + y2) // 2


def nodes(xml):
    return [m.group(0) for m in re.finditer(r"<node[^>]*", xml)]


def attr(n, k):
    m = re.search(r"\b" + k + r'="([^"]*)"', n)
    return m.group(1) if m else None


sh("shell", "input", "keyevent", "224")
time.sleep(1)
sh("shell", "input", "keyevent", "82")
time.sleep(1)
sh("shell", "am", "force-stop", PKG)
time.sleep(1)
sh("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")

# Espera a que la app esté montada (pantalla de pedidos).
for _ in range(30):
    time.sleep(2)
    xml = dump()
    if PKG in set(re.findall(r'package="([^"]+)"', xml)) and "Buscando el servidor" not in xml:
        break
print("app lista; textos:", re.findall(r'text="([^"]+)"', xml)[:6])

# Referencia: alto de la barra de estado (el primer nodo con texto de sistema).
found = None
for attempt in range(6):
    sh("shell", "input", "keyevent", "3")   # HOME
    time.sleep(2)
    sh("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    # Sondea rápido el banner.
    for _ in range(12):
        xml = dump()
        for n in nodes(xml):
            t = attr(n, "text") or ""
            if any(t.startswith(x) for x in TEXTS):
                found = (t, attr(n, "bounds"))
                break
        if found:
            break
        time.sleep(0.7)
    if found:
        break
    print(f"  intento {attempt + 1}: no alcancé a ver el banner")

if not found:
    print("!! no logré capturar el banner (no es concluyente, no necesariamente está mal)")
    sys.exit(1)

text, bounds = found
top = int(re.findall(r"\d+", bounds)[1])
print(f"banner: {text!r} bounds={bounds} (y superior del texto = {top})")
print(f"alto de la barra de estado en este equipo ≈ 65 px")
print("OK" if top >= 60 else "MAL: el texto sigue bajo la barra de estado")
