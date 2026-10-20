#!/bin/sh
# Sube solo los archivos listados en $1 (rutas relativas a $2) al volumen
# mercaldas_media, reintentando indefinidamente hasta completar. Reanuda con
# --partial/--append-verify para sobrevivir cortes de red.
set -u

LIST="${1:-/tmp/media_products_files.txt}"
SRC="${2:-/home/jk/Proyectos/dsi/ecommerce/db/}"
RSH="${3:-/tmp/rsync-wsl.sh}"
DEST="dsi-vps:/var/lib/docker/volumes/mercaldas_media/_data/"
LOG="${4:-/tmp/rsync-products.log}"

while :; do
  rsync -a --partial --append-verify --chown=10001:10001 \
    --files-from="$LIST" -e "$RSH" "$SRC" "$DEST" >>"$LOG" 2>&1
  rc=$?
  printf 'rsync rc=%s %s\n' "$rc" "$(date -Is)" >>"$LOG"
  [ "$rc" -eq 0 ] && exit 0
  sleep 15
done
