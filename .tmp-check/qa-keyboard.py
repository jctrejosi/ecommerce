#!/usr/bin/env python3
"""Variante QA del picking: verifica que el formulario quede sobre el teclado."""
import re
import subprocess
import sys
import time

ADB = "/home/jk/Android/Sdk/platform-tools/adb"
SERIAL = "dd03888"
PKG = "com.dsi.pickingapp.qa"


def sh(*a, timeout=90):
    return subprocess.run([ADB, "-s", SERIAL, *a], capture_output=True, text=True, timeout=timeout).stdout


def dump():
    sh("shell", "uiautomator", "dump", "/sdcard/kq.xml")
    return sh("shell", "cat", "/sdcard/kq.xml")


def nodes(xml, cls):
    key = 'class="' + cls + '"'
    return [m.group(0) for m in re.finditer(r"<node[^>]*", xml) if key in m.group(0)]


def attr(n, k):
    m = re.search(r"\b" + k + r'="([^"]*)"', n)
    return m.group(1) if m else None


def center(b):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", b))
    return (x1 + x2) // 2, (y1 + y2) // 2


def pkgs(xml):
    return set(re.findall(r'package="([^"]+)"', xml))


sh("shell", "input", "keyevent", "224")
time.sleep(1)
sh("shell", "input", "keyevent", "82")
time.sleep(1)

sh("shell", "am", "force-stop", PKG)
time.sleep(1)
sh("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")

xml = ""
ready = False
for i in range(45):
    time.sleep(2)
    xml = dump()
    if PKG in pkgs(xml) and "EditText" in xml and "Buscando el servidor" not in xml:
        ready = True
        break
    if PKG not in pkgs(xml):
        sh("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    elif i % 5 == 4:
        print("  esperando a que resuelva la red…")

if not ready:
    print("!! no llegué al formulario. paquetes:", sorted(pkgs(xml)))
    print("   textos:", re.findall(r'text="([^"]+)"', xml))
    sys.exit(1)

print("=== LOGIN SIN TECLADO ===")
for t in re.findall(r'text="([^"]+)"', xml):
    print("   ", t)
for n in nodes(xml, "android.widget.EditText"):
    print("   campo bounds=%s" % attr(n, "bounds"))
subprocess.run(f"{ADB} -s {SERIAL} exec-out screencap -p > .tmp-check/qa-sin.png", shell=True)

edits = nodes(xml, "android.widget.EditText")
x, y = center(attr(edits[1] if len(edits) > 1 else edits[0], "bounds"))
print(f"tocando el campo de contraseña en ({x},{y})")
sh("shell", "input", "tap", str(x), str(y))
time.sleep(4)

xml2 = dump()
if PKG not in pkgs(xml2):
    print("!! la app salió de primer plano. paquetes:", sorted(pkgs(xml2)))
    sys.exit(1)

print("=== LOGIN CON TECLADO ABIERTO ===")
for t in re.findall(r'text="([^"]+)"', xml2):
    print("   ", t)
for n in nodes(xml2, "android.widget.EditText"):
    print("   campo foco=%s bounds=%s" % (attr(n, "focused"), attr(n, "bounds")))
for n in nodes(xml2, "android.view.ViewGroup"):
    if attr(n, "content-desc") == "Iniciar sesión":
        print("   botón Iniciar sesión bounds=%s" % attr(n, "bounds"))
subprocess.run(f"{ADB} -s {SERIAL} exec-out screencap -p > .tmp-check/qa-con.png", shell=True)
print("capturas: .tmp-check/qa-sin.png y .tmp-check/qa-con.png")
