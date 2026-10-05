#!/bin/bash
# Watchdog scrcpy: relanza la ventana embebida del OPPO si el USB se cae.
# Uso: setsid -f bash scrcpy-watch.sh >/tmp/scrcpy-watch.log 2>&1
export DISPLAY=:0.0
export XAUTHORITY=/home/jk/.Xauthority

SERIAL=dd03888
while true; do
  scrcpy -s "$SERIAL" \
    --window-title='OPPO A60' \
    --stay-awake \
    --always-on-top \
    --window-width=420 \
    --window-x=40 \
    --window-y=40
  echo "$(date '+%F %T') scrcpy terminó (código $?); reintentando en 3s..." >> /tmp/scrcpy-watch.log
  sleep 3
done
