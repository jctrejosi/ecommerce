#!/usr/bin/env sh
# Crea una API key para la ingesta de tracking.
#
#   ./scripts/new-api-key.sh "web-local"
#
# Imprime la clave UNA sola vez. En la base solo queda su hash
# sha256(clave + ":" + TRACKING_API_KEY_SALT).
set -eu

name="${1:?uso: ./scripts/new-api-key.sh <nombre>}"

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "falta backend-tracking/.env (copiar .env.example)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

: "${TRACKING_DATABASE_URL:?TRACKING_DATABASE_URL no definida}"
: "${TRACKING_API_KEY_SALT:?TRACKING_API_KEY_SALT no definida}"

key="$(openssl rand -hex 32)"
hash="$(printf '%s' "$key:$TRACKING_API_KEY_SALT" | sha256sum | cut -d' ' -f1)"

psql "$TRACKING_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "insert into tracking_api_keys (name, key_hash) values ('$name', '$hash');" >/dev/null

echo "API key creada para '$name' (guardarla ahora, no se vuelve a mostrar):"
echo
echo "  $key"
echo
