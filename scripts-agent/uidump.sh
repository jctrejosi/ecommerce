#!/bin/sh
# Vuelca la jerarquía de UI del dispositivo conectado por adb y lista los textos
# con sus coordenadas (útil para pulsar con `input tap`).
#
# Uso: scripts-agent/uidump.sh [serial] [texto-a-extraer]
set -e

SERIAL="${1:-192.168.0.114:41157}"
FILTER="${2:-}"
ADB=/home/jk/Android/Sdk/platform-tools/adb
OUT=scripts-agent/.scratch/ui-dump.xml
mkdir -p "$(dirname "$OUT")"

"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell cmd statusbar collapse >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell rm -f /sdcard/ui-dump.xml

FOCUS=$("$ADB" -s "$SERIAL" shell dumpsys window 2>/dev/null | grep -m1 "mCurrentFocus" | tr -d '\r')
echo "enfoque: $FOCUS"

"$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/ui-dump.xml >/dev/null 2>&1
"$ADB" -s "$SERIAL" pull /sdcard/ui-dump.xml "$OUT" >/dev/null 2>&1

python3 - "$OUT" "$FILTER" <<'PY'
import re, sys

path, filt = sys.argv[1], sys.argv[2]
xml = open(path).read()
rows = []
for node in re.finditer(r"<node[^>]*>", xml):
    s = node.group(0)
    t = re.search(r'text="([^"]*)"', s)
    c = re.search(r'class="([^"]*)"', s)
    b = re.search(r'bounds="([^"]*)"', s)
    if not (t and b):
        continue
    text = t.group(1)
    if filt and filt.lower() not in text.lower():
        continue
    if text.strip():
        # centro de la caja, para `input tap X Y`
        coords = [int(n) for n in re.findall(r"-?\d+", b.group(1))]
        center = ((coords[0] + coords[2]) // 2, (coords[1] + coords[3]) // 2)
        rows.append((text, c.group(1).split(".")[-1] if c else "", b.group(1), center))

if not rows:
    print("(sin textos; ¿pantalla apagada o app en segundo plano?)")
for text, cls, bounds, center in rows:
    print(f"{center[0]:>5},{center[1]:<5} {cls:<12} {text[:90]}")
PY
