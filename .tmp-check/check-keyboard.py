#!/usr/bin/env python3
"""
Verifica que con el teclado abierto el formulario de login quede por encima.

Seguridad: no toca la pantalla hasta confirmar (por el dump) que el paquete en
primer plano es el de picking; así no se escribe en otra app.
"""
import re
import subprocess
import sys
import time

ADB = "/home/jk/Android/Sdk/platform-tools/adb"
SERIAL = "dd03888"
PKG = "com.dsi.pickingapp"


def sh(*a, timeout=90):
    return subprocess.run([ADB, "-s", SERIAL, *a], capture_output=True, text=True, timeout=timeout).stdout


def dump():
    sh("shell", "uiautomator", "dump", "/sdcard/k.xml")
    return sh("shell", "cat", "/sdcard/k.xml")


def nodes(xml, cls):
    key = 'class="' + cls + '"'
    return [m.group(0) for m in re.finditer(r"<node[^>]*", xml) if key in m.group(0)]


def attr(n, k):
    m = re.search(r"\b" + k + r'="([^"]*)"', n)
    return m.group(1) if m else None


def center(b):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", b))
    return (x1 + x2) // 2, (y1 + y2) // 2


def foreground_package(xml):
    pkgs = set(re.findall(r'package="([^"]+)"', xml))
    return pkgs


def screen_on():
    out = sh("shell", "dumpsys display")
    m = re.search(r"mScreenState=(\w+)", out)
    return m.group(1) if m else "?"


# 1) Despertar y quitar el bloqueo.
sh("shell", "input", "keyevent", "224")  # WAKEUP
time.sleep(1)
sh("shell", "input", "keyevent", "82")   # MENU (descarta el keyguard simple)
time.sleep(1)
print("estado de pantalla:", screen_on())

# 2) Traer la app al frente.
sh("shell", "am", "force-stop", PKG)
time.sleep(1)

def launch():
    sh("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")

launch()

xml = ""
ready = False
for i in range(40):
    time.sleep(2)
    xml = dump()
    pkgs = foreground_package(xml)
    if PKG in pkgs and "Buscando el servidor" not in xml and "EditText" in xml:
        ready = True
        break
    if PKG not in pkgs:
        # Otra app se puso al frente: la volvemos a traer.
        print(f"  (al frente: {sorted(pkgs)}) re-lanzando picking…")
        launch()
    elif i % 5 == 4:
        print("  esperando a que resuelva la red…")

if not ready:
    print("!! no llegué al formulario de login. Paquetes:", sorted(foreground_package(xml)))
    print("   textos:", re.findall(r'text="([^"]+)"', xml))
    sys.exit(1)

print("textos:", re.findall(r'text="([^"]+)"', xml))
edits = nodes(xml, "android.widget.EditText")
if not edits:
    print("!! sin campos de texto")
    sys.exit(1)

print("--- campos ANTES de tocar ---")
for n in edits:
    print("   text=%r hint=%r bounds=%s" % (attr(n, "text"), attr(n, "hint"), attr(n, "bounds")))

x, y = center(attr(edits[0], "bounds"))
print(f"tocando el primer campo en ({x},{y})")
sh("shell", "input", "tap", str(x), str(y))
time.sleep(3)

xml2 = dump()
if PKG not in foreground_package(xml2):
    print("!! la app salió de primer plano tras el tap")
    sys.exit(1)

print("--- campos DESPUES de tocar (teclado abierto) ---")
for n in nodes(xml2, "android.widget.EditText"):
    print("   text=%r foco=%s bounds=%s" % (attr(n, "text"), attr(n, "focused"), attr(n, "bounds")))
print("--- textos visibles ---")
for t in re.findall(r'text="([^"]+)"', xml2):
    print("   ", t)

subprocess.run(f"{ADB} -s {SERIAL} exec-out screencap -p > .tmp-check/kb.png", shell=True)
print("captura: .tmp-check/kb.png")
