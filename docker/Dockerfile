# syntax=docker/dockerfile:1
# ============================================================
# Imagen ÚNICA (un solo contenedor) del stack Mercaldas:
#   backend NestJS + bot FastAPI + 5 interfaces web (Vite) + Caddy.
#
# Caddy expone :80/:443 (único publicado) y enruta por dominio/host a cada
# interfaz; backend y bot escuchan solo en 127.0.0.1 (red interna). Los
# dominios/hosts se configuran por variables de entorno en runtime
# (ver docker/gen-caddyfile.mjs y docker/docker-compose.yml).
#
# Construir: docker compose -f docker/docker-compose.yml build
# El contexto de build es la raíz del repo.
# ============================================================

# ── 1. Backend NestJS ───────────────────────────────────────
FROM node:20-bookworm-slim AS backend
WORKDIR /build/backend

# Dependencias primero (capa cacheable).
COPY backend/package.json backend/yarn.lock ./
RUN yarn install --frozen-lockfile

COPY backend/ ./
# Nest compila src/ a dist/; drizzle/ (importado por el runtime) se compila aparte.
RUN yarn build \
 && ./node_modules/.bin/tsc \
      --outDir dist --rootDir . \
      --module nodenext --moduleResolution nodenext --target ES2023 \
      --esModuleInterop --skipLibCheck --declaration false --sourceMap false \
      drizzle/schema.ts drizzle/relations.ts

# ── 2. Interfaces web (Vite) ────────────────────────────────
# `VITE_API_URL` se hornea en el bundle: pásalo como --build-arg con la URL
# pública del API (p. ej. https://api.tudominio.com).
FROM node:20-bookworm-slim AS fronts
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=${VITE_API_URL} \
    CI=true
RUN corepack enable
WORKDIR /fronts
COPY ["Interface web client", "web"]
COPY ["Interface web admin", "admin"]
COPY ["Interface web picking", "picking"]
COPY ["Interface web picking admin", "picking-admin"]
COPY ["Interface web delivery admin", "delivery-admin"]
RUN set -eux; \
    for d in web admin picking picking-admin delivery-admin; do \
      ( cd "$d" && pnpm install --frozen-lockfile && pnpm run build ); \
    done

# ── 3. Runtime: Node + Python + Caddy ───────────────────────
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BACKEND_PORT=3100 \
    BOT_PORT=8001

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Caddy: reverse proxy (TLS automático) y servidor de estáticos.
ARG CADDY_VERSION=2.9.1
RUN curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" \
      | tar -xz -C /usr/local/bin caddy \
    && chmod +x /usr/local/bin/caddy

WORKDIR /app

# Backend compilado.
COPY --from=backend /build/backend/dist ./backend/dist
COPY --from=backend /build/backend/node_modules ./backend/node_modules
COPY --from=backend /build/backend/package.json ./backend/package.json
COPY --from=backend /build/backend/scripts/sync-schema.js ./backend/scripts/sync-schema.js
COPY --from=backend /build/backend/scripts/picking-shelves.sql ./backend/scripts/picking-shelves.sql

# Interfaces compiladas (una carpeta por interfaz).
COPY --from=fronts /fronts/web/dist /srv/web
COPY --from=fronts /fronts/admin/dist /srv/admin
COPY --from=fronts /fronts/picking/dist /srv/picking
COPY --from=fronts /fronts/picking-admin/dist /srv/picking-admin
COPY --from=fronts /fronts/delivery-admin/dist /srv/delivery-admin

# Bot (Python).
COPY bot/ ./bot
RUN python3 -m venv /opt/bot-venv \
 && /opt/bot-venv/bin/pip install --no-cache-dir -r ./bot/requirements.txt

# Proxy + arranque.
COPY docker/entrypoint.sh ./entrypoint.sh
COPY docker/gen-caddyfile.mjs ./gen-caddyfile.mjs
RUN chmod +x ./entrypoint.sh

EXPOSE 80 443
CMD ["./entrypoint.sh"]
