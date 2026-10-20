#!/bin/bash
# Watchdog scrcpy: relanza la ventana embebida del OPPO SOLO si el USB se cae.
# Si cierras la ventana tú mismo (el dispositivo sigue conectado por adb),
# el watchdog se detiene y NO la reabre.
#
# Uso: setsid -f bash scrcpy-watch.sh >/tmp/scrcpy-watch.log 2>&1
export DISPLAY=:0.0
export XAUTHORITY=/home/jk/.Xauthority

SERIAL=dd03888
while true; do
  # Sin --always-on-top: la ventana flota normal pero NO se queda siempre delante.
  scrcpy -s "$SERIAL" \
    --window-title='OPPO A60' \
    --stay-awake \
    --window-width=420 \
    --window-x=40 \
    --window-y=40

  sleep 2  # deja que adb se estabilice antes de comprobar el dispositivo

  # Si el dispositivo SIGUE conectado, la ventana se cerró a propósito: no reabrir.
  if adb -s "$SERIAL" get-state >/dev/null 2>&1; then
    echo "$(date '+%F %T') ventana cerrada por el usuario; watchdog detenido." >> /tmp/scrcpy-watch.log
    break
  fi

  echo "$(date '+%F %T') dispositivo desconectado (USB caído); reintentando en 3s..." >> /tmp/scrcpy-watch.log
  sleep 3
done
