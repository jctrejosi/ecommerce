#!/bin/bash
# Muestra el hash del archivo y el estado SET/EMPTY de cada clave, sin valores.
f="${1:?uso: env-status.sh <archivo>}"
echo "sha256=$(sha256sum "$f" | cut -d' ' -f1)"
tr -d '\r' < "$f" | while IFS='=' read -r k v; do
  [ -z "$k" ] && continue
  case "$k" in \#*) continue ;; esac
  if [ -n "$v" ]; then
    echo "$k=SET"
  else
    echo "$k=EMPTY"
  fi
done
