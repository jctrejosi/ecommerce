# `docker/` — despliegue en un contenedor único

Imagen única con **backend + bot + las interfaces web + Caddy**. Solo se publican
`80`/`443`; backend, bot y BD quedan internos.

| Proceso | Puerto (interno) | Internet |
|---|---|---|
| Backend NestJS | `127.0.0.1:3100` | ❌ |
| Bot FastAPI | `127.0.0.1:8001` | ❌ |
| Caddy (proxy + TLS + estáticos) | `:80` / `:443` | ✅ único |

📖 **Guía completa (Windows Server, firewall, DNS, seguridad y checklist):
[`docs/DESPLIEGUE-DOCKER.md`](../docs/DESPLIEGUE-DOCKER.md)**

## Rápido

```bash
cp docker/.env.example docker/.env    # dominios, TLS, DATABASE_URL, secretos

docker compose -f docker/docker-compose.yml build \
  --build-arg VITE_API_URL=https://api.tudominio.com

docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps
```

## Archivos

| Archivo | Rol |
|---|---|
| `Dockerfile` | Multi-stage: backend + fronts (Vite) + bot → runtime con Node, Python y Caddy. |
| `entrypoint.sh` | Arranca backend/bot (127.0.0.1) y Caddy (`:80/:443`) + genera el Caddyfile. |
| `gen-caddyfile.mjs` | Vhosts por dominio, cabeceras de seguridad, HSTS y Basic Auth opcional. |
| `docker-compose.yml` | Un servicio, redes `edge`+`internal`, volúmenes de Caddy, `cap_drop`, healthcheck. |
| `.env.example` | Dominios (`HOST_*`), TLS, secretos y BD. |

## Seguridad (resumen)

- Solo `80`/`443` publicados; `3100`/`8001` escuchan en `127.0.0.1` dentro del contenedor.
- BD en la red `mercaldas_internal` (`internal: true`), nunca publicada.
- TLS Let's Encrypt + HSTS + `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; se oculta `Server`.
- `PROTECT_ADMIN=true` → Basic Auth en admin, picking-admin y delivery-admin.
- Certificados persistentes en los volúmenes `mercaldas_caddy_data`/`mercaldas_caddy_config`.
- Contenedor con `no-new-privileges` y `cap_drop: ALL` (+ `NET_BIND_SERVICE`).

> Cambiar un dominio no requiere rebuild (edita `docker/.env` y `up -d`).
> Cambiar `VITE_API_URL` **sí** requiere rebuild (va horneado en los fronts).
