#!/usr/bin/env bash
# Respaldo de las tablas implicadas y creación del staging.
set -euo pipefail
BK=/mnt/c/Users/Desarrolo4/Documents/ecommerce/db/backups
mkdir -p "$BK"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BK/pre-sync-catalogo-$STAMP.dump"

echo "=== respaldo ==="
docker exec ecommerce_postgres pg_dump -U postgres -d ecommerce -Fc \
  -t categories -t products -t product_categories -t media -t product_images -t settings \
  > "$OUT"
ls -lh "$OUT"
echo "respaldo: $OUT"
