#!/usr/bin/env bash
# Arranque del contenedor `ecommerce_proxy` (Caddy interno).
#
# Genera el Caddyfile en runtime desde variables de entorno (gen-caddyfile.mjs),
# así que los dominios/hosts y los upstreams se cambian sin rebuild.
#
# Este Caddy NO termina TLS: el certificado lo pone el edge compartido
# (Cloudflare Origin CA). Aquí se sirve HTTP en :8080.
set -euo pipefail

HTTP_PORT="${HTTP_PORT:-8080}"
export HTTP_PORT

# Los paneles de administración se protegen con Basic Auth si PROTECT_ADMIN=true.
# Sin credenciales NO arrancamos, para no dejarlos abiertos por descuido.
PROTECT_ADMIN="${PROTECT_ADMIN:-true}"
if [ "$PROTECT_ADMIN" = "true" ] && [ -z "${ADMIN_PASSWORD_HASH:-}" ] && [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "✘ PROTECT_ADMIN=true pero falta ADMIN_PASSWORD o ADMIN_PASSWORD_HASH." >&2
  echo "  Define una en docker/.env, o pon PROTECT_ADMIN=false (no recomendado)." >&2
  exit 1
fi

# CORS_ORIGIN: si no lo defines, se deriva de los HOST_* de las interfaces.
if [ -z "${CORS_ORIGIN:-}" ]; then
  scheme="${PUBLIC_SCHEME:-https}"
  CORS_ORIGIN=""
  for h in "${HOST_WEB:-}" "${HOST_ADMIN:-}" \
           "${HOST_PICKING_ADMIN:-}" "${HOST_DELIVERY_ADMIN:-}"; do
    [ -n "$h" ] && CORS_ORIGIN="${CORS_ORIGIN:+$CORS_ORIGIN,}${scheme}://${h}"
  done
  export CORS_ORIGIN
fi

echo "==> proxy: Caddy :${HTTP_PORT} (backend ${BACKEND_UPSTREAM:-backend:3100})"
node /app/gen-caddyfile.mjs
caddy fmt --overwrite "${CADDYFILE_OUT:-/config/Caddyfile.generated}"

exec caddy run --config "${CADDYFILE_OUT:-/config/Caddyfile.generated}" --adapter caddyfile
