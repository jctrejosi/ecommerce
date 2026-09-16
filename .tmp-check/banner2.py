#!/usr/bin/env python3
"""
Fuerza el banner del servidor apagando el Wi-Fi del equipo unos segundos, mide
la posición del texto y vuelve a encender el Wi-Fi (siempre, incluso si falla).
"""
import re
import subprocess
import sys
import time

ADB = "/home/jk/Android/Sdk/platform-tools/adb"
SERIAL = "dd03888"
PKG = "com.dsi.pickingapp"
TEXTS = ("Sin conexión con el servidor", "Buscando el servidor en la red")


def sh(*a, timeout=90):
    return subprocess.run([ADB, "-s", SERIAL, *a], capture_output=True, text=True, timeout=timeout).stdout


def dump():
    sh("shell", "uiautomator", "dump", "/sdcard/b.xml")
    return sh("shell", "cat", "/sdcard/b.xml")


def nodes(xml):
    return [m.group(0) for m in re.finditer(r"<node[^>]*", xml)]


def attr(n, k):
    m = re.search(r"\b" + k + r'="([^"]*)"', n)
    return m.group(1) if m else None


result = None
try:
    sh("shell", "input", "keyevent", "224")
    time.sleep(1)
    sh("shell", "input", "keyevent", "82")
    time.sleep(1)

    print("apagando Wi-Fi del equipo…")
    sh("shell", "svc", "wifi", "disable")
    time.sleep(6)

    for attempt in range(20):
        xml = dump()
        for n in nodes(xml):
            t = attr(n, "text") or ""
            if any(t == x for x in TEXTS):
                result = (t, attr(n, "bounds"))
                break
        if result:
            break
        time.sleep(1)
finally:
    print("encendiendo Wi-Fi del equipo…")
    sh("shell", "svc", "wifi", "enable")
    time.sleep(3)

if not result:
    print("!! no apareció el banner; no concluyente")
    sys.exit(1)

text, bounds = result
top = int(re.findall(r"\d+", bounds)[1])
print(f"banner: {text!r} bounds={bounds} -> y superior del texto = {top} px")
print("barra de estado del equipo: ~0-65 px")
print("RESULTADO:", "OK (el texto queda debajo de la barra de estado)" if top >= 60 else "MAL (sigue encimado)")
