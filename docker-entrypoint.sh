#!/usr/bin/env bash
# Arranca los CUATRO procesos del servicio único de Mercaldas:
#   1. backend NestJS   → 127.0.0.1:3100  (interno, dedicado)
#   2. bot FastAPI      → 127.0.0.1:8001  (interno)
#   3. ia-service FastAPI → 127.0.0.1:8002  (interno, campañas)
#   4. Caddy (proxy)    → $PORT (público, el que inyecta Render)
set -euo pipefail

# Puertos internos DEDICADOS: evitan chocar con $PORT (Render puede
# inyectarlo como 10000 o, si lo configuras distinto, como 3000, etc.)
PUBLIC_PORT="${PORT:-10000}"
BACKEND_PORT="${BACKEND_PORT:-3100}"
BOT_PORT="${BOT_PORT:-8001}"  # 8000 lo usa el QrService (analizador externo)
IA_SERVICE_PORT="${IA_SERVICE_PORT:-8002}"

echo "==> Mercaldas: proxy :${PUBLIC_PORT} → backend :${BACKEND_PORT} y /bot → :${BOT_PORT}"

# ---- Backend NestJS ----
cd /app/backend

# Sync de esquema idempotente: agrega columnas nuevas si faltan (picking, etc.)
echo "==> backend: sync de esquema (ADD COLUMN IF NOT EXISTS)"
DATABASE_URL="${DATABASE_URL:-}" DB_SSL="${DB_SSL:-false}" node scripts/sync-schema.js || true

MAIN="dist/src/main.js"
[ -f "$MAIN" ] || MAIN="dist/main.js"
echo "==> backend: node $MAIN"
BACKEND_PORT="$BACKEND_PORT" node "$MAIN" &
BACKEND_PID=$!

# ---- Bot FastAPI ----
cd /app/bot
echo "==> bot: uvicorn en 127.0.0.1:${BOT_PORT}"
/opt/bot-venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$BOT_PORT" &
BOT_PID=$!

# ---- IA Service (recomendación de campañas) ----
cd /app/ia-service
echo "==> ia-service: uvicorn en 127.0.0.1:${IA_SERVICE_PORT}"
/opt/ia-service-venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$IA_SERVICE_PORT" &
IA_SERVICE_PID=$!

# ---- Caddy (proxy público) ----
cd /app
echo "==> caddy: proxy en :${PUBLIC_PORT}"
HTTP_PORT="$PUBLIC_PORT" caddy run --config /app/Caddyfile --adapter caddyfile &
CADDY_PID=$!

# Si cualquiera muere, se detiene todo (Render reinicia el servicio).
trap 'kill "$BACKEND_PID" "$BOT_PID" "$IA_SERVICE_PID" "$CADDY_PID" 2>/dev/null || true' INT TERM EXIT

wait -n "$BACKEND_PID" "$BOT_PID" "$IA_SERVICE_PID" "$CADDY_PID"
