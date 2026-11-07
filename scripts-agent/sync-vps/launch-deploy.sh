#!/usr/bin/env bash
# Lanza deploy/deploy.sh en background (systemd-run) y deja el log en /tmp/deploy-sync.log
set -u
REPO=/mnt/c/Users/Desarrolo4/Documents/ecommerce
LOG=/tmp/deploy-sync.log

rm -f "$LOG"
systemctl reset-failed mercaldas-sync 2>/dev/null || true
systemd-run --unit=mercaldas-sync --collect \
  --property=WorkingDirectory="$REPO" \
  --property=StandardOutput=append:"$LOG" \
  --property=StandardError=append:"$LOG" \
  --property=TimeoutStartSec=0 \
  /bin/bash "$REPO/deploy/deploy.sh"

sleep 5
echo "--- estado unidad ---"
systemctl is-active mercaldas-sync || true
echo "--- primeras líneas del log ---"
head -20 "$LOG" 2>/dev/null || echo "sin log todavía"
