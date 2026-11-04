#!/bin/sh
# Descarga un modelo usando el cliente Ollama de Windows (interop) lanzado desde
# WSL, de forma que el proceso no dependa de una sesión SSH abierta.
#
# Uso: pull-model.sh <modelo>
set -eu

MODEL="${1:-qwen3:8b}"
OLLAMA_EXE="/mnt/c/Users/Desarrolo4/ollama/ollama.exe"

# El interop de WSL necesita un socket en /run/WSL. Sin sesión interactiva la
# variable WSL_INTEROP no existe, pero el socket persistente del arranque sí
# (1_interop -> 2_interop).
if [ -z "${WSL_INTEROP:-}" ] || [ ! -S "${WSL_INTEROP}" ]; then
  WSL_INTEROP=/run/WSL/1_interop
fi
export WSL_INTEROP

echo "==> Descargando ${MODEL} con el cliente Windows (${OLLAMA_EXE})"
"${OLLAMA_EXE}" pull "${MODEL}"
echo "==> Descarga finalizada"
