#!/usr/bin/env bash
# Recorta el hilo 'Admin' de Zed si volvió a inflarse (contexto DeepSeek 1M).
#
# IMPORTANTE: ejecutar con Zed CERRADO. Si Zed está abierto, sus copias en
# memoria pueden pisar el recorte al salir.
set -euo pipefail

cd /home/jk/Proyectos/dsi/ecommerce
python3 scripts-agent/zed-thread-doctor.py trim \
  --id 7ba75950 \
  --apply
