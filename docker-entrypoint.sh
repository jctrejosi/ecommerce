#!/usr/bin/env bash
# Arranca los CUATRO procesos del servicio único de MercAldas:
#   1. backend NestJS   → 127.0.0.1:3100  (interno, dedicado)
#   2. bot FastAPI      → 127.0.0.1:8001  (interno)
#   3. admin-ia FastAPI → 127.0.0.1:8002  (interno, campañas)
#   4. Caddy (proxy)    → $PORT (público, el que inyecta Render)
set -euo pipefail

# Puertos internos DEDICADOS: evitan chocar con $PORT (Render puede
# inyectarlo como 10000 o, si lo configuras distinto, como 3000, etc.)
PUBLIC_PORT="${PORT:-10000}"
BACKEND_PORT="${BACKEND_PORT:-3100}"
BOT_PORT="${BOT_PORT:-8001}"  # 8000 lo usa el QrService (analizador externo)
ADMIN_IA_PORT="${ADMIN_IA_PORT:-8002}"

echo "==> MercAldas: proxy :${PUBLIC_PORT} → backend :${BACKEND_PORT} y /bot → :${BOT_PORT}"

# ---- Backend NestJS ----
cd /app/backend
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

# ---- Admin IA (recomendación de campañas) ----
cd /app/admin-ia
echo "==> admin-ia: uvicorn en 127.0.0.1:${ADMIN_IA_PORT}"
/opt/admin-ia-venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$ADMIN_IA_PORT" &
ADMIN_IA_PID=$!

# ---- Caddy (proxy público) ----
cd /app
echo "==> caddy: proxy en :${PUBLIC_PORT}"
HTTP_PORT="$PUBLIC_PORT" caddy run --config /app/Caddyfile --adapter caddyfile &
CADDY_PID=$!

# Si cualquiera muere, se detiene todo (Render reinicia el servicio).
trap 'kill "$BACKEND_PID" "$BOT_PID" "$ADMIN_IA_PID" "$CADDY_PID" 2>/dev/null || true' INT TERM EXIT

wait -n "$BACKEND_PID" "$BOT_PID" "$ADMIN_IA_PID" "$CADDY_PID"
