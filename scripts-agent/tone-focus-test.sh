#!/bin/sh
# Prueba del tono forzando el primer plano de la app mientras llega un mensaje.
#
# Mantiene la app de delivery al frente y, a mitad de la ventana, envía un
# mensaje del cliente en el pedido en curso. Al final imprime si el sistema de
# audio registró una reproducción de la app (esto es la prueba real: si aparece
# un AudioTrack de com.dsi.deliveryapp, el tono sonó).
#
# Uso: scripts-agent/tone-focus-test.sh [serial] [orderCode]
set -e

SERIAL="${1:-dd03888}"
ORDER="${2:-MER-10539055}"
ADB=/home/jk/Android/Sdk/platform-tools/adb
BASE="${BASE_URL:-http://localhost:3000}"

echo "== forzando primer plano durante 24 s =="
(
  i=0
  while [ "$i" -lt 12 ]; do
    "$ADB" -s "$SERIAL" shell am start -n com.dsi.deliveryapp/.MainActivity >/dev/null 2>&1 || true
    sleep 2
    i=$((i + 1))
  done
) &
LOOP=$!

sleep 7
echo "== enviando mensaje del cliente =="
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "$BASE/orders/track/$ORDER/messages" \
  -H "Content-Type: application/json" \
  -d "{\"body\":\"prueba tono $(date +%H:%M:%S)\"}"

wait "$LOOP"

echo "== enfoque ahora =="
"$ADB" -s "$SERIAL" shell dumpsys window 2>/dev/null | grep -m1 -oE "mCurrentFocus=[^}]*" || true

echo "== reproducciones de la app =="
"$ADB" -s "$SERIAL" shell dumpsys audio 2>/dev/null > /tmp/tone-focus-audio.txt
awk '/^Events log: playback activity/{f=1;next} /^Events log:/{f=0} f' /tmp/tone-focus-audio.txt \
  | grep -E "package:com.dsi.deliveryapp" | tail -4
