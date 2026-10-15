#!/usr/bin/env bash
# Arranque del contenedor único de Mercaldas:
#   1. backend NestJS   → 127.0.0.1:${BACKEND_PORT:-3100}  (interno)
#   2. bot FastAPI      → 127.0.0.1:${BOT_PORT:-8001}      (interno)
#   3. Caddy            → :${HTTP_PORT:-8080} / :${HTTPS_PORT:-8443}  (el compose publica 80/443)
#
# El Caddyfile se genera en runtime desde variables de entorno
# (gen-caddyfile.mjs), así que los dominios/hosts se configuran sin rebuild.
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-3100}"
BOT_PORT="${BOT_PORT:-8001}"
# Caddy no corre como root → escucha en puertos altos que el compose publica 80/443.
HTTP_PORT="${HTTP_PORT:-8080}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
export BACKEND_PORT BOT_PORT HTTP_PORT HTTPS_PORT

# ── Salvaguardas de seguridad (fail-closed) ─────────────────

# TLS=false publica el sitio sin cifrar (credenciales y tokens en claro): hay
# que aceptarlo explícitamente para evitar dejarlo así por descuido.
TLS="${TLS:-true}"
if [ "$TLS" = "false" ] && [ "${ALLOW_INSECURE:-false}" != "true" ]; then
  echo "✘ TLS=false publica el sitio SIN cifrar (credenciales y tokens en claro)." >&2
  echo "  Si es una prueba local a propósito, arranca con ALLOW_INSECURE=true." >&2
  exit 1
fi
if [ "$TLS" = "false" ]; then
  echo "⚠️  TLS DESACTIVADO (ALLOW_INSECURE=true): el tráfico viaja sin cifrar." >&2
fi

# Los paneles de administración (y /bot) se protegen con Basic Auth por defecto:
# sin credenciales NO arrancamos, en vez de dejarlos abiertos en silencio.
PROTECT_ADMIN="${PROTECT_ADMIN:-true}"
if [ "$PROTECT_ADMIN" = "true" ] && [ -z "${ADMIN_PASSWORD_HASH:-}" ] && [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "✘ PROTECT_ADMIN=true pero falta ADMIN_PASSWORD o ADMIN_PASSWORD_HASH." >&2
  echo "  Define una en docker/.env, o pon PROTECT_ADMIN=false (no recomendado)." >&2
  exit 1
fi

# CORS_ORIGIN: si no lo defines, se deriva de los HOST_* de las interfaces.
if [ -z "${CORS_ORIGIN:-}" ]; then
  scheme="https"
  [ "$TLS" = "false" ] && scheme="http"
  CORS_ORIGIN=""
  for h in "${HOST_WEB:-}" "${HOST_ADMIN:-}" \
           "${HOST_PICKING_ADMIN:-}" "${HOST_DELIVERY_ADMIN:-}"; do
    [ -n "$h" ] && CORS_ORIGIN="${CORS_ORIGIN:+$CORS_ORIGIN,}${scheme}://${h}"
  done
  export CORS_ORIGIN
fi

echo "==> Mercaldas (contenedor único): backend :${BACKEND_PORT} · bot :${BOT_PORT} · Caddy :${HTTP_PORT}/:${HTTPS_PORT}"
node /app/gen-caddyfile.mjs
# Normaliza el formato (evita el aviso de 'not formatted' de Caddy).
caddy fmt --overwrite "${CADDYFILE_OUT:-/config/Caddyfile.generated}"

# ---- Backend NestJS ----
cd /app/backend
# Sync de esquema idempotente (ADD COLUMN IF NOT EXISTS); si falla se avisa,
# pero no se aborta el arranque (la app reintenta al conectar).
echo "==> backend: sync de esquema"
if ! DATABASE_URL="${DATABASE_URL:-}" DB_SSL="${DB_SSL:-false}" node scripts/sync-schema.js; then
  echo "==> backend: ⚠️  el sync de esquema falló (¿DATABASE_URL o BD caída?); se continúa" >&2
fi

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
echo "==> caddy: :${HTTP_PORT}/:${HTTPS_PORT}"
caddy run --config "${CADDYFILE_OUT:-/config/Caddyfile.generated}" --adapter caddyfile &
CADDY_PID=$!

# Si cualquiera muere, se detiene todo (el orquestador reinicia el contenedor).
trap 'kill "$BACKEND_PID" "$BOT_PID" "$CADDY_PID" 2>/dev/null || true' INT TERM EXIT

wait -n "$BACKEND_PID" "$BOT_PID" "$CADDY_PID"
