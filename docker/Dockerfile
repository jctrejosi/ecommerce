# syntax=docker/dockerfile:1
# ============================================================
# Imágenes del stack Mercaldas, UNA POR SERVICIO.
#
# El proyecto compose `ecommerce` (docker/docker-compose.yml) construye estos
# targets y los levanta como contenedores independientes:
#
#   backend-runtime → ecommerce_backend   (NestJS, :3100)
#   bot-runtime     → ecommerce_bot       (FastAPI, :8001)
#   web-client      → ecommerce_client    (SPA cliente, nginx :8080)
#   web-admin       → ecommerce_admin     (SPA admin)
#   web-delivery    → ecommerce_delivery  (SPA delivery admin)
#   web-picking     → ecommerce_picking   (SPA picking admin)
#   proxy           → ecommerce_proxy     (Caddy interno, :8080)
#
# Todos los runtime corren como usuario SIN privilegios. Los dominios/hosts se
# configuran por variables de entorno del proxy en runtime
# (ver docker/gen-caddyfile.mjs), no se hornean en las imágenes.
#
# El contexto de build es la raíz del repo.
# ============================================================

# ── 1. Backend NestJS (build) ───────────────────────────────
FROM node:20-bookworm-slim AS backend-build
WORKDIR /build/backend

# Dependencias primero (capa cacheable).
COPY backend/package.json backend/yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY backend/ ./
# Nest compila src/ a dist/; drizzle/ (importado por el runtime) se compila aparte.
RUN yarn build \
 && ./node_modules/.bin/tsc \
      --outDir dist --rootDir . \
      --module nodenext --moduleResolution nodenext --target ES2023 \
      --esModuleInterop --skipLibCheck --declaration false --sourceMap false \
      drizzle/schema.ts drizzle/relations.ts

# ── 2. Interfaces web (build de las 4 SPAs) ─────────────────
# `VITE_API_URL` se hornea en el bundle: pásalo como --build-arg con la URL
# pública del API (p. ej. https://ecommerce-api.tudominio.com).
FROM node:20-bookworm-slim AS fronts-build
ARG VITE_API_URL=http://localhost:3000
ARG VITE_BOT_API_URL=
# Client ID público de Google OAuth. Se pasa como build-arg para no depender
# de un .env.production local (que no se versiona y no llega al CI).
ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_GOOGLE_REDIRECT_URI=
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_BOT_API_URL=${VITE_BOT_API_URL} \
    VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID} \
    VITE_GOOGLE_REDIRECT_URI=${VITE_GOOGLE_REDIRECT_URI} \
    CI=true
RUN corepack enable
WORKDIR /fronts
COPY ["Interface web client", "web"]
COPY ["Interface web admin", "admin"]
COPY ["Interface web picking admin", "picking-admin"]
COPY ["Interface web delivery admin", "delivery-admin"]
RUN set -eux; \
    for d in web admin picking-admin delivery-admin; do \
      ( cd "$d" && pnpm install --frozen-lockfile && pnpm run build ); \
    done

# ── 3. Backend (runtime) ────────────────────────────────────
FROM node:20-bookworm-slim AS backend-runtime

ENV NODE_ENV=production \
    BACKEND_PORT=3100

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=backend-build /build/backend/dist ./backend/dist
COPY --from=backend-build /build/backend/node_modules ./backend/node_modules
COPY --from=backend-build /build/backend/package.json ./backend/package.json
COPY --from=backend-build /build/backend/scripts/sync-schema.js ./backend/scripts/sync-schema.js
COPY --from=backend-build /build/backend/scripts/picking-shelves.sql ./backend/scripts/picking-shelves.sql

COPY docker/backend-entrypoint.sh ./backend/entrypoint.sh

# Normaliza CRLF (el repo puede clonarse/trabajarse en Windows), da permisos,
# crea los directorios persistentes (medios locales en /app/db, logs) y un
# usuario SIN privilegios con el que se ejecuta el backend.
RUN sed -i 's/\r$//' ./backend/entrypoint.sh \
 && chmod +x ./backend/entrypoint.sh \
 && mkdir -p /app/db /app/backend/logs \
 && groupadd --system --gid 10001 merc \
 && useradd --system --uid 10001 --gid merc --home-dir /app --shell /usr/sbin/nologin merc \
 && chown -R merc:merc /app/db /app/backend/logs

WORKDIR /app/backend
USER merc
EXPOSE 3100
ENTRYPOINT ["./entrypoint.sh"]

# ── 4. Bot FastAPI (runtime) ────────────────────────────────
FROM python:3.12-slim AS bot-runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BOT_PORT=8001

WORKDIR /app
COPY bot/ ./
RUN pip install --no-cache-dir -r ./requirements.txt \
 && useradd --system --uid 10002 --home-dir /app --shell /usr/sbin/nologin botuser \
 && chown -R botuser:botuser /app
USER botuser
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]

# ── 5. Interfaces web (runtime: nginx sin privilegios) ──────
FROM nginxinc/nginx-unprivileged:1.27-alpine AS web-base
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080

FROM web-base AS web-client
COPY --from=fronts-build /fronts/web/dist /usr/share/nginx/html

FROM web-base AS web-admin
COPY --from=fronts-build /fronts/admin/dist /usr/share/nginx/html

FROM web-base AS web-delivery
COPY --from=fronts-build /fronts/delivery-admin/dist /usr/share/nginx/html

FROM web-base AS web-picking
COPY --from=fronts-build /fronts/picking-admin/dist /usr/share/nginx/html

# ── 6. Proxy interno (Caddy) ────────────────────────────────
# Solo enruta por host al backend y a cada contenedor de interfaz. El TLS lo
# termina el edge compartido (docker/edge/), así que aquí va en HTTP puro.
FROM caddy:2.11.7-alpine AS proxy

RUN apk add --no-cache nodejs bash \
 # El binario oficial lleva la file-capability NET_BIND_SERVICE; con
 # `cap_drop: ALL` el exec falla con EPERM. La copia no conserva xattrs,
 # así que el Caddy sin privilegios arranca en :8080 sin capabilities.
 && cp /usr/bin/caddy /usr/local/bin/caddy \
 && chmod 755 /usr/local/bin/caddy

WORKDIR /app
COPY docker/proxy-entrypoint.sh ./entrypoint.sh
COPY docker/gen-caddyfile.mjs ./gen-caddyfile.mjs

RUN mkdir -p /data /config \
 && chmod +x ./entrypoint.sh \
 && addgroup -g 10001 -S merc \
 && adduser -u 10001 -S -G merc -h /app merc \
 && chown -R merc:merc /data /config /app

ENV XDG_DATA_HOME=/data \
    XDG_CONFIG_HOME=/config \
    CADDYFILE_OUT=/config/Caddyfile.generated \
    HTTP_PORT=8080

USER merc
EXPOSE 8080
ENTRYPOINT ["./entrypoint.sh"]
