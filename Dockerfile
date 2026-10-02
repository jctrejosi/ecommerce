# syntax=docker/dockerfile:1

# ============================================================
# Etapa 1 — compilar el backend NestJS
# ============================================================
FROM node:20-bookworm-slim AS backend-build

WORKDIR /build/backend

# Dependencias primero (capa cacheable)
COPY backend/package.json backend/yarn.lock ./
RUN yarn install --frozen-lockfile

# Fuente completa + build
COPY backend/ ./
RUN yarn build

# El build de Nest excluye drizzle/ del tsconfig.build.json, pero el runtime
# lo importa desde dist (../../drizzle/schema). Se compila aparte:
RUN ./node_modules/.bin/tsc \
    --outDir dist --rootDir . \
    --module nodenext --moduleResolution nodenext --target ES2023 \
    --esModuleInterop --skipLibCheck --declaration false --sourceMap false \
    drizzle/schema.ts drizzle/relations.ts

# ============================================================
# Etapa 2 — runtime: backend (Node) + bot (Python) + proxy (Caddy)
# ============================================================
FROM node:20-bookworm-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NODE_ENV=production

# Python para el bot + curl para descargar Caddy
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Caddy: reverse proxy. Backend y bot escuchan en puertos internos y
# Caddy expone uno solo (el PORT de Render).
ARG CADDY_VERSION=2.9.1
RUN curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin caddy \
    && chmod +x /usr/local/bin/caddy

WORKDIR /app

# Backend compilado + node_modules + package.json
COPY --from=backend-build /build/backend/dist ./backend/dist
COPY --from=backend-build /build/backend/node_modules ./backend/node_modules
COPY --from=backend-build /build/backend/package.json ./backend/package.json

# Script de sync de esquema (corre al arrancar; ver docker-entrypoint.sh)
COPY --from=backend-build /build/backend/scripts/sync-schema.js ./backend/scripts/sync-schema.js
COPY --from=backend-build /build/backend/scripts/picking-shelves.sql ./backend/scripts/picking-shelves.sql

# Bot (Python)
COPY bot/ ./bot
RUN python3 -m venv /opt/bot-venv \
    && /opt/bot-venv/bin/pip install --no-cache-dir -r ./bot/requirements.txt

# IA Service (Python: recomendación de contenido de campañas)
COPY crm/ia-service/ ./ia-service
RUN python3 -m venv /opt/ia-service-venv \
    && /opt/ia-service-venv/bin/pip install --no-cache-dir -r ./ia-service/requirements.txt

# Proxy y arranque
COPY Caddyfile ./Caddyfile
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 10000

CMD ["./docker-entrypoint.sh"]
