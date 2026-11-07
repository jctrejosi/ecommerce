#!/usr/bin/env bash
# Arranque del contenedor `ecommerce_backend` (NestJS).
#
# El sync de esquema es idempotente (ADD COLUMN IF NOT EXISTS). Si falla se
# avisa, pero NO se aborta el arranque: la app reintenta al conectar.
set -euo pipefail

cd /app/backend
BACKEND_PORT="${BACKEND_PORT:-3100}"

echo "==> backend: sync de esquema"
if ! node scripts/sync-schema.js; then
  echo "==> backend: ⚠️  el sync de esquema falló (¿DATABASE_URL o BD caída?); se continúa" >&2
fi

MAIN="dist/src/main.js"
[ -f "$MAIN" ] || MAIN="dist/main.js"
echo "==> backend: node $MAIN (0.0.0.0:${BACKEND_PORT})"
exec node "$MAIN"
