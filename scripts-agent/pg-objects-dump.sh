#!/usr/bin/env bash
#
# Extrae los archivos FÍSICOS (heap + _fsm + _vm) de tablas Postgres del
# contenedor a un directorio local, tal cual están en disco.
#
# No es un export lógico: son los segmentos de `$PGDATA/base/<oid>/<relfilenode>`.
# Ver `db/objects/README.md` para el porqué y las limitaciones.
#
# Uso:
#   bash scripts-agent/pg-objects-dump.sh <destino> [tabla ...]
#   bash scripts-agent/pg-objects-dump.sh db/objects                 # set de productos
#   bash scripts-agent/pg-objects-dump.sh db/objects orders payments
#
# Variables: PG_CONTAINER (def. ecommerce_postgres), PG_DB (def. ecommerce),
#            PG_USER (def. postgres).
set -euo pipefail

CONTAINER=${PG_CONTAINER:-ecommerce_postgres}
DB=${PG_DB:-ecommerce}
USER=${PG_USER:-postgres}

DEST=${1:?uso: pg-objects-dump.sh <destino> [tabla ...]}
shift || true
TABLES=("$@")

if [ ${#TABLES[@]} -eq 0 ]; then
  TABLES=(
    products product_variants product_images media product_attributes attributes
    prices inventory branch_products product_categories product_types
    product_type_assignments brands suppliers supplier_products categories branches
  )
fi

OID=$(docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -tAc \
  "SELECT oid FROM pg_database WHERE datname='$DB'")
BASE="/var/lib/postgresql/data/base/$OID"
OUT="$DEST/$DB"
mkdir -p "$OUT"
MAN="$OUT/MANIFEST.tsv"
printf 'tabla\trelfilenode\trelkind\theap_bytes\tarchivos\n' > "$MAN"

echo "BD=$DB oid=$OID contenedor=$CONTAINER -> $OUT"
for t in "${TABLES[@]}"; do
  row=$(docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -tAc \
    "SELECT relfilenode||'|'||relkind::text||'|'||pg_relation_size(oid) FROM pg_class WHERE relname='$t' AND relnamespace='public'::regnamespace AND relkind='r'")
  if [ -z "$row" ]; then
    echo "  · omitida (no existe o no es tabla): $t"
    continue
  fi
  node=$(echo "$row" | cut -d'|' -f1)
  kind=$(echo "$row" | cut -d'|' -f2)
  size=$(echo "$row" | cut -d'|' -f3)
  files=""
  for suffix in "" "_fsm" "_vm"; do
    f="$node$suffix"
    if docker exec "$CONTAINER" sh -c "test -f '$BASE/$f'"; then
      docker cp "$CONTAINER:$BASE/$f" "$OUT/$f" >/dev/null
      files="$files $f"
    fi
  done
  printf '%s\t%s\t%s\t%s\t%s\n' "$t" "$node" "$kind" "$size" "${files# }" >> "$MAN"
  echo "  $t  ->  $node  (${size} bytes)"
done

echo "manifiesto: $MAN"
