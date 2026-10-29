#!/usr/bin/env bash
# Exporta a CSV las tablas implicadas en el delta de catálogo.
# Uso: bash export-csv.sh <directorio-salida>
set -euo pipefail
OUT="${1:?falta directorio de salida}"
mkdir -p "$OUT"
PG="docker exec ecommerce_postgres psql -U postgres -d ecommerce"

q() { # q <archivo> <sql>
  $PG -Atc "COPY ($2) TO STDOUT WITH (FORMAT csv, HEADER true)" > "$OUT/$1.csv"
  printf '%-22s %s filas\n' "$1" "$(( $(wc -l < "$OUT/$1.csv") - 1 ))"
}

q categories \
  "select id, parent_id, name, slug, code, level, display_order, image_media_id, is_active, deleted_at from categories"

q products \
  "select id, is_active, visibility, is_public, deleted_at from products"

q product_categories \
  "select product_id, category_id from product_categories"

q media \
  "select id, status, media_type, provider, path, file_name, mime_type, size_bytes, width, height, checksum, alt_text, is_public from media"

q product_images \
  "select id, product_id, media_id, is_cover, position from product_images"

q settings \
  "select key, value::text from settings where key = 'landing_categories'"
