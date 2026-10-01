#!/usr/bin/env bash
# Reinicio orquestado de Zed: cierra la app, re-recorta el hilo Admin si el
# cierre volcó una copia inflada, y relanza Zed. Pensado para lanzarse en
# segundo plano. Log: /tmp/zed-restart-agent.log
set -u

LOG=/tmp/zed-restart-agent.log
PROJ=/home/jk/Proyectos/dsi/ecommerce
ZED_BIN=/home/jk/.local/zed-preview.app/libexec/zed-editor

echo "== inicio del reinicio orquestado ==" >> "$LOG"

# Dar tiempo a que el mensaje del agente se muestre antes de cerrar Zed.
sleep 25

pkill -TERM -x zed-editor
for _ in 1 2 3 4 5 6 7 8 9 10; do
  pgrep -x zed-editor >/dev/null || break
  sleep 2
done
if pgrep -x zed-editor >/dev/null; then
  pkill -KILL -x zed-editor
  sleep 3
fi

# Re-recortar en reposo (por si Zed volcó al salir).
sleep 2
bash "$PROJ/scripts-agent/fix-zed-threads.sh" >> "$LOG" 2>&1
python3 "$PROJ/scripts-agent/zed-thread-doctor.py" status --id 7ba75950 >> "$LOG" 2>&1

# Relanzar Zed con el entorno gráfico de la sesión.
sleep 2
DISPLAY=:0.0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  setsid nohup "$ZED_BIN" >> "$LOG" 2>&1 < /dev/null &
echo "== Zed relanzado ==" >> "$LOG"
sleep 5
if pgrep -x zed-editor >/dev/null; then
  echo "== verificacion: zed-editor arriba ==" >> "$LOG"
else
  echo "== verificacion: OJO, zed-editor no arrancó ==" >> "$LOG"
fi
