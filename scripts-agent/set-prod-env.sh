#!/bin/bash
# Fija las variables de producción que NO son secretas en docker/.env.
# Idempotente: reemplaza la clave si existe o la añade al final.
# No imprime valores, solo KEY=SET.
set -euo pipefail

env_file="${1:?uso: set-prod-env.sh <ruta/docker/.env>}"
[ -f "$env_file" ] || { echo "no existe: $env_file" >&2; exit 1; }

set_key() {
  key="$1"
  value="$2"
  python3 - "$env_file" "$key" "$value" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text().splitlines()
replaced = False
for i, line in enumerate(lines):
    if line.startswith(key + "="):
        lines[i] = key + "=" + value
        replaced = True
        break
if not replaced:
    lines.append(key + "=" + value)
path.write_text("\n".join(lines) + "\n")
PY
  echo "$key=SET"
}

# Orígenes exactos de las interfaces (el navegador envía Origin y la API debe
# reflejarlo). Se listan los cuatro paneles/web; no se usa comodín.
set_key CORS_ORIGIN "https://mercaldas.jcti.xyz,https://admin.mercaldas.jcti.xyz,https://picking-admin.mercaldas.jcti.xyz,https://delivery-admin.mercaldas.jcti.xyz"
# Los fronts hacen fetch(..., { credentials: "include" }): sin esta cabecera el
# navegador bloquea la respuesta (síntoma: página "502 Servidor no disponible").
set_key CORS_CREDENTIALS "true"
set_key FRONTEND_URL "https://mercaldas.jcti.xyz"
set_key JWT_EXPIRES_IN "7d"
set_key REFRESH_TOKEN_EXPIRES_IN "30d"
set_key CUSTOMER_JWT_EXPIRES_IN "7d"
set_key CUSTOMER_JWT_REFRESH_EXPIRES_IN "30d"
set_key WOMPI_REDIRECT_URL "https://mercaldas.jcti.xyz"
set_key EPAYCO_TEST "false"
# El bot ya NO se publica en Caddy: el backend lo proxya en /bot por loopback
# dentro del contenedor. El propio bot aplica su rate limit y CORS interno.
# El bot se enlaza con --port "$BOT_PORT" (compose lo fija en 8001); se deja
# también esta clave para el proxy del backend (BOT_INTERNAL_URL por defecto).
set_key BOT_API_PORT "8001"
# CSP: el frontend carga Google Fonts (fonts.googleapis.com). La política por
# defecto solo permite estilos propios, así que se habilita ese origen.
set_key CSP_POLICY "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; frame-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self' https:"
