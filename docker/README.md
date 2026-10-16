# `docker/` — despliegue en un contenedor único

Imagen única con **backend + bot + las interfaces web + Caddy**. Solo se publican
`80`/`443`; backend, bot y BD quedan internos.

| Proceso | Puerto (interno) | Publicado | Internet |
|---|---|---|---|
| Backend NestJS | `127.0.0.1:3100` | ❌ | ❌ |
| Bot FastAPI | `127.0.0.1:8001` | ❌ | ❌ |
| Caddy (proxy + TLS + estáticos) | `:8080` / `:8443` | `127.0.0.1:30180` / `127.0.0.1:30181` | ❌ (lo alcanza el edge) |
| **Edge compartido** (`edge/`) | `:80` / `:443` | `80` / `443` | ✅ **único** |

Puertos propios de cada proyecto (nada «genérico» que choque con IIS u otros
servicios): ecommerce `30180/30181`, CRM `30280/30281` (en loopback). El edge es
el único que publica 80/443 y el único que habla TLS con internet.

📖 **Guía completa (Windows Server, firewall, DNS, seguridad y checklist):
[`docs/DESPLIEGUE-DOCKER.md`](../docs/DESPLIEGUE-DOCKER.md)**

## Rápido

> Atajo con lanzador: `node prod.js` (sincroniza `docker/.env` desde `prod.config.json`,
> valida secretos y construye/levanta; `--with-db` levanta también la BD; `--dns`
> imprime qué configurar). Abajo, los comandos manuales equivalentes.

```bash
cp docker/.env.example docker/.env    # dominios, TLS, DATABASE_URL, secretos

docker compose -f docker/docker-compose.yml build \
  --build-arg VITE_API_URL=https://api.tudominio.com

docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps

# Edge compartido: publica 80/443 y hace TLS para todos los dominios
cd docker/edge && docker compose up -d
```

> En `docker/.env` (modo edge, recomendado si hay más proyectos en el servidor):
> `TLS=false`, `ALLOW_INSECURE=true`, `PUBLIC_SCHEME=https`,
> `PUBLIC_HTTP_PORT=127.0.0.1:30180`, `PUBLIC_HTTPS_PORT=127.0.0.1:30181`.
> Para desplegar el ecommerce **solo** (sin edge): `TLS=true` y
> `PUBLIC_HTTP_PORT=80` / `PUBLIC_HTTPS_PORT=443`.
> Detalles: [`edge/README.md`](./edge/README.md).

## Archivos

| Archivo | Rol |
|---|---|
| `Dockerfile` | Multi-stage: backend + fronts (Vite) + bot → runtime con Node, Python y Caddy. |
| `entrypoint.sh` | Arranca backend/bot (127.0.0.1) y Caddy (`:80/:443`) + genera el Caddyfile. |
| `gen-caddyfile.mjs` | Vhosts por dominio, cabeceras de seguridad, HSTS y Basic Auth opcional. |
| `docker-compose.yml` | Un servicio, redes `edge`+`internal`, volúmenes de Caddy, `cap_drop`, healthcheck. |
| `.env.example` | Dominios (`HOST_*`), TLS, secretos y BD. |

## Seguridad (resumen)

- Solo el edge publica `80`/`443`; el contenedor publica `127.0.0.1:30180/30181` (loopback) y `3100`/`8001` escuchan en `127.0.0.1` dentro del contenedor.
- **El contenedor no corre como root** (usuario `merc`); Caddy escucha en `8080`/`8443`.
- BD en la red `mercaldas_internal` (`internal: true`), nunca publicada.
- TLS Let's Encrypt + HSTS + `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`, `Content-Security-Policy`; se oculta `Server`.
- `PROTECT_ADMIN=true` **por defecto** (fail-closed si falta la contraseña) y `PROTECT_BOT=true` para `/bot`.
- **Rate limit** en `/auth/*` y `/customer-auth/*` (backend) y en `/chat`/`/cart*` (bot), por IP.
- `TLS=false` exige `ALLOW_INSECURE=true`; `MAX_REQUEST_BODY` acota el cuerpo; API de admin de Caddy desactivada.
- Certificados persistentes en los volúmenes `mercaldas_caddy_data`/`mercaldas_caddy_config`; medios locales en `mercaldas_media`.
- Contenedor con `no-new-privileges` y `cap_drop: ALL`, rotación de logs de Docker.

> Cambiar un dominio no requiere rebuild (edita `docker/.env` y `up -d`).
> Cambiar `VITE_API_URL` **sí** requiere rebuild (va horneado en los fronts).
