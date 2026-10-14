#!/usr/bin/env bash
# Arranque del contenedor único de Mercaldas:
#   1. backend NestJS   → 127.0.0.1:${BACKEND_PORT:-3100}  (interno)
#   2. bot FastAPI      → 127.0.0.1:${BOT_PORT:-8001}      (interno)
#   3. Caddy            → :80 / :443  (único puerto publicado)
#
# El Caddyfile se genera en runtime desde variables de entorno
# (gen-caddyfile.mjs), así que los dominios/hosts se configuran sin rebuild.
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-3100}"
BOT_PORT="${BOT_PORT:-8001}"
export BACKEND_PORT BOT_PORT

# CORS_ORIGIN: si no lo defines, se deriva de los HOST_* de las interfaces.
if [ -z "${CORS_ORIGIN:-}" ]; then
  scheme="https"
  [ "${TLS:-true}" = "false" ] && scheme="http"
  CORS_ORIGIN=""
  for h in "${HOST_WEB:-}" "${HOST_ADMIN:-}" \
           "${HOST_PICKING_ADMIN:-}" "${HOST_DELIVERY_ADMIN:-}"; do
    [ -n "$h" ] && CORS_ORIGIN="${CORS_ORIGIN:+$CORS_ORIGIN,}${scheme}://${h}"
  done
  export CORS_ORIGIN
fi

echo "==> Mercaldas (contenedor único): backend :${BACKEND_PORT} · bot :${BOT_PORT} · Caddy :80/:443"
node /app/gen-caddyfile.mjs
# Normaliza el formato (evita el aviso de 'not formatted' de Caddy).
caddy fmt --overwrite /app/Caddyfile.generated

# ---- Backend NestJS ----
cd /app/backend
# Sync de esquema idempotente (ADD COLUMN IF NOT EXISTS); no aborta si falla.
echo "==> backend: sync de esquema"
DATABASE_URL="${DATABASE_URL:-}" DB_SSL="${DB_SSL:-false}" node scripts/sync-schema.js || true

MAIN="dist/src/main.js"
[ -f "$MAIN" ] || MAIN="dist/main.js"
echo "==> backend: node $MAIN (:${BACKEND_PORT})"
BACKEND_PORT="$BACKEND_PORT" node "$MAIN" &
BACKEND_PID=$!

# ---- Bot FastAPI ----
cd /app/bot
echo "==> bot: uvicorn (:${BOT_PORT})"
/opt/bot-venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$BOT_PORT" &
BOT_PID=$!

# ---- Caddy (proxy + TLS + estáticos) ----
cd /app
echo "==> caddy: :80/:443"
caddy run --config /app/Caddyfile.generated --adapter caddyfile &
CADDY_PID=$!

# Si cualquiera muere, se detiene todo (el orquestador reinicia el contenedor).
trap 'kill "$BACKEND_PID" "$BOT_PID" "$CADDY_PID" 2>/dev/null || true' INT TERM EXIT

wait -n "$BACKEND_PID" "$BOT_PID" "$CADDY_PID"
