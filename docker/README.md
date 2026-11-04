# `docker/` — despliegue del ecommerce (un contenedor por servicio)

Proyecto compose **`ecommerce`**. Cada parte del stack corre en su propio
contenedor, con nombre explícito y reinicio independiente:

| Contenedor | Servicio | Puerto | Expuesto a internet |
|---|---|---|---|
| `ecommerce_db` | PostgreSQL + PostGIS | `127.0.0.1:5432` (solo host) | ❌ |
| `ecommerce_backend` | NestJS | `3100` (red interna) | ❌ |
| `ecommerce_bot` | FastAPI | `8001` (red interna) | ❌ |
| `ecommerce_client` | SPA cliente (nginx) | `8080` (red interna) | ❌ |
| `ecommerce_admin` | SPA administración (nginx) | `8080` (red interna) | ❌ |
| `ecommerce_delivery` | SPA delivery admin (nginx) | `8080` (red interna) | ❌ |
| `ecommerce_picking` | SPA picking admin (nginx) | `8080` (red interna) | ❌ |
| `ecommerce_proxy` | Caddy interno (enrutado por host/ruta) | `127.0.0.1:30180` | ❌ (lo alcanza el edge) |
| `ecommerce_osrm` | Motor de rutas | `5000` (red interna) | ❌ |
| **`edge_caddy`** | Edge compartido (otro proyecto) | `80` / `443` | ✅ **único** |

Solo el **edge compartido** publica `80/443` y termina TLS (certificado de
origen de Cloudflare). El proxy interno habla HTTP en `:8080` y el backend es el
único que llega al bot, por `/bot/*`.

📖 Guía completa (DNS, TLS, firewall, Cloudflare, checklist):
[`docs/DESPLIEGUE-DOCKER.md`](../docs/DESPLIEGUE-DOCKER.md).

## Rápido

```bash
cp docker/.env.example docker/.env    # dominios, DATABASE_URL, secretos

# Construye las 7 imágenes (backend, bot, 4 SPAs y proxy)
docker compose -f docker/docker-compose.yml --env-file docker/.env build

# Levanta todo (la BD incluida) y espera healthchecks
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d

docker compose -f docker/docker-compose.yml --env-file docker/.env ps
```

Con `node prod.js` se hace lo mismo, sincronizando `docker/.env` desde
`prod.config.json` y validando secretos antes de construir.

> Los volúmenes conservan los nombres heredados (`db_postgres_data`,
> `mercaldas_media`) **a propósito**: así la migración desde el contenedor único
> no pierde datos ni imágenes ya subidas.

## Archivos

| Archivo | Rol |
|---|---|
| `Dockerfile` | Multi-target: `backend-runtime`, `bot-runtime`, `web-client/admin/delivery/picking`, `proxy`. |
| `backend-entrypoint.sh` | Sync de esquema idempotente + arranque de NestJS. |
| `proxy-entrypoint.sh` | Arranque de Caddy y generación del Caddyfile. |
| `gen-caddyfile.mjs` | Vhosts por dominio (con alias heredados), cabeceras de seguridad y Basic Auth opcional. |
| `nginx.conf` | Servidor estático de cada SPA: fallback SPA, caché de assets, `/healthz`. |
| `docker-compose.yml` | Proyecto `ecommerce`, 9 servicios, redes `ecommerce_edge`/`ecommerce_internal`/`shared_edge`. |
| `edge/sites/ecommerce.caddy` | Bloque del edge para este proyecto (se sincroniza desde `deploy.sh`). |
| `.env.example` | Dominios (`HOST_*` + `*_LEGACY`), BD, secretos y OAuth. |

## Seguridad (resumen)

- Solo el edge publica `80/443`. La BD y el proxy se publican **solo en loopback**.
- El API se sirve en el mismo origen que `HOST_WEB` (`/catalog/*`, `/orders`,
  `/static/*`, `/socket.io/*`, `/bot/*`, …). `HOST_API` sirve el API completo.
- Todos los runtime corren como usuario **sin privilegios** (`merc`, `botuser`,
  usuario de nginx-unprivileged) con `no-new-privileges` y `cap_drop: ALL`.
- Redes separadas: los fronts y la BD viven en `ecommerce_internal`
  (`internal: true`), sin salida a internet. Backend y bot sí salen (APIs externas).
- HSTS lo añade el edge; el proxy añade CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`,
  `Permissions-Policy` y oculta `Server`.
- `PROTECT_ADMIN=true` es fail-closed (sin contraseña, el proxy no arranca).
- Rotación de logs de Docker (`10m` × 3) en todos los servicios.

> Cambiar un dominio no requiere rebuild (edita `docker/.env` y `up -d`).
> Cambiar `VITE_API_URL` **sí** requiere rebuild (va horneado en los fronts).
