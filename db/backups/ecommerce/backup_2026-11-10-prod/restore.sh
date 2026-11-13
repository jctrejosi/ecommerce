#!/usr/bin/env bash
# =============================================================================
# Restaura el backup de producción 2026-11-10 en una base local.
#
# Uso:
#   bash restore.sh [nombre_bd]
#
# Variables opcionales:
#   POSTGRES_CONTAINER  (por defecto: ecommerce_postgres)
#   POSTGRES_USER       (por defecto: postgres)
#
# ATENCIÓN: la base destino se BORRA y se vuelve a crear.
# =============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${1:-ecommerce}"
CONTAINER="${POSTGRES_CONTAINER:-ecommerce_postgres}"
PGUSER="${POSTGRES_USER:-postgres}"
TMP="${TMPDIR:-/tmp}/ecommerce_prod_2026-11-10.dump"
CREATED=0

cleanup() { if [ "$CREATED" = "1" ]; then rm -f "$TMP"; fi; }
trap cleanup EXIT

echo "== 1/4 Localizando el dump =="
if [ -f "$DIR/ecommerce.dump" ]; then
  DUMP="$DIR/ecommerce.dump"
elif compgen -G "$DIR/ecommerce.dump.part-*" >/dev/null; then
  cat "$DIR"/ecommerce.dump.part-* > "$TMP"
  DUMP="$TMP"
  CREATED=1
else
  echo "   ERROR: no se encontró ecommerce.dump ni ecommerce.dump.part-*"
  exit 1
fi
ls -lh "$DUMP" | awk '{print "   dump: " $5}'

echo "== 2/4 Verificando sha256 =="
EXPECTED="$(cut -d' ' -f1 "$DIR/ecommerce.dump.sha256")"
ACTUAL="$(sha256sum "$DUMP")"
ACTUAL="${ACTUAL%% *}"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "   ERROR: sha256 no coincide (esperado $EXPECTED, obtenido $ACTUAL)"
  exit 1
fi
echo "   OK: $ACTUAL"

echo "== 3/4 Recreando base '$DB' en $CONTAINER =="
docker exec "$CONTAINER" psql -U "$PGUSER" -q -c "drop database if exists \"$DB\" with (force);"
docker exec "$CONTAINER" psql -U "$PGUSER" -q -c "create database \"$DB\";"

echo "== 4/4 Restaurando (schema + datos) =="
docker exec -i "$CONTAINER" pg_restore -U "$PGUSER" -d "$DB" \
  --no-owner --no-acl < "$DUMP"

echo "== Verificación =="
docker exec "$CONTAINER" psql -U "$PGUSER" -d "$DB" -tAc \
  "select 'products='||(select count(*) from products)
       ||' product_images='||(select count(*) from product_images)
       ||' customers='||(select count(*) from customers)
       ||' orders='||(select count(*) from orders)
       ||' users='||(select count(*) from users);"

echo
echo "Listo. Valores esperados: products=21613 product_images=18671 customers=146324 orders=4 users=6"
echo "Recuerda: las imágenes viven en db/images_static/ (ver README.md)."
