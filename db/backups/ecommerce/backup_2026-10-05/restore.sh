#!/usr/bin/env bash
# Restaura el respaldo de db/backups/ecommerce en el PostgreSQL del proyecto.
#
# Uso:
#   ./db/backups/ecommerce/restore.sh                       # ecommerce_postgres / ecommerce
#   DB_CONTAINER=otro DB_NAME=otra ./db/backups/ecommerce/restore.sh
#
# Reensambla las partes, comprueba el sha256 del volcado completo y restaura.
# Al final verifica conteos: si algo salió mal, lo dice (no falla en silencio).
set -euo pipefail

CONTAINER="${DB_CONTAINER:-ecommerce_postgres}"
DB="${DB_NAME:-ecommerce}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="${TMPDIR:-/tmp}/ecommerce_restore.dump"
CTMP="/tmp/ecommerce_restore.dump"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# ── 1. Reensamblar ─────────────────────────────────────────────
if [ -f "$DIR/ecommerce.dump" ]; then
  echo "→ Usando el volcado completo ecommerce.dump"
  cp "$DIR/ecommerce.dump" "$TMP"
else
  echo "→ Reensamblando partes (part-*)..."
  cat "$DIR"/ecommerce.dump.part-* > "$TMP"
fi

# ── 2. Verificar integridad (clave en otro PC) ─────────────────
if [ -f "$DIR/ecommerce.dump.sha256" ]; then
  EXPECTED="$(tr -d '[:space:]' < "$DIR/ecommerce.dump.sha256")"
  ACTUAL="$(sha256_of "$TMP")"
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "✘ El respaldo NO coincide con su sha256." >&2
    echo "  esperado: $EXPECTED" >&2
    echo "  obtenido: $ACTUAL" >&2
    echo "  Suele ser por partes faltantes o descargadas a medias: vuelve a copiar db/backups/ecommerce/ completo." >&2
    rm -f "$TMP"
    exit 1
  fi
  echo "✓ sha256 OK"
fi

# ── 3. Copiar al contenedor y restaurar ────────────────────────
echo "→ Copiando al contenedor $CONTAINER..."
docker cp "$TMP" "$CONTAINER:$CTMP"
rm -f "$TMP"

echo "→ Restaurando en la BD $DB (pg_restore)..."
set +e
docker exec "$CONTAINER" pg_restore -U postgres -d "$DB" \
  --clean --if-exists --no-owner --no-privileges "$CTMP"
RC=$?
set -e
docker exec "$CONTAINER" rm -f "$CTMP"
echo "  pg_restore exit=$RC (los avisos benignos no impiden la restauración)"

# ── 4. Verificación (no fallar en silencio) ────────────────────
echo "→ Verificando conteos..."
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  "SELECT 'branches=' || count(*) FROM branches
   UNION ALL SELECT 'products=' || count(*) FROM products
   UNION ALL SELECT 'prices=' || count(*) FROM prices
   UNION ALL SELECT 'inventory=' || count(*) FROM inventory
   UNION ALL SELECT 'orders=' || count(*) FROM orders"

echo "✓ Restauración terminada."
