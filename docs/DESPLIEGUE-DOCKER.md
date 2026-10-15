# Despliegue en un contenedor único (Docker) — guía del servidor

Imagen única con **todo el stack** dentro de **un solo contenedor**:

| Proceso | Escucha en | Expuesto a internet |
|---|---|---|
| Backend NestJS | `127.0.0.1:3100` (dentro del contenedor) | ❌ nunca directamente |
| Bot FastAPI | `127.0.0.1:8001` (dentro del contenedor) | ❌ nunca directamente |
| PostgreSQL | red interna `mercaldas_internal` | ❌ nunca |
| **Caddy** (proxy + TLS + estáticos) | `:8080` / `:8443` (el host publica `80`/`443`) | ✅ **único puerto publicado** |

Los archivos viven en `docker/` (`Dockerfile`, `docker-compose.yml`,
`gen-caddyfile.mjs`, `entrypoint.sh`, `.env.example`).

Interfaces incluidas (build Vite): `Interface web client` (`HOST_WEB`),
`Interface web admin` (`HOST_ADMIN`), `Interface web picking admin`
(`HOST_PICKING_ADMIN`) y `Interface web delivery admin`
(`HOST_DELIVERY_ADMIN`). Las apps **Expo** (delivery/picking móvil) no se sirven
en este contenedor: se compilan a APK/IPA apuntando a `HOST_API`.

> Nota: `Interface web picking/` y `Interface web analytics/` existen en el repo
> pero **no tienen proyecto** (solo `node_modules`/`.vite` rastreados por error);
> por eso no se compilan ni se sirven.

> Este despliegue es independiente del `Dockerfile`/`Caddyfile` de la raíz (que
> son para Render). No se afectan entre sí.

---

## 1. Modelo de seguridad

- **Solo se publican 80 y 443** al host. Backend, bot y BD no se publican: el
  backend y el bot escuchan en `127.0.0.1` dentro del contenedor y la BD vive en
  la red `mercaldas_internal` (`internal: true`), sin ruta a internet.
- **TLS** con Let's Encrypt (Caddy) cuando `TLS=true`; HSTS activado.
- **Cabeceras de seguridad** en todos los vhosts: `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, y se elimina la cabecera `Server`.
- **Basic Auth opcional** en los paneles de administración
  (`PROTECT_ADMIN=true` protege `HOST_ADMIN`, `HOST_PICKING_ADMIN` y
  `HOST_DELIVERY_ADMIN`).
- **Endurecimiento del contenedor**: `no-new-privileges`, `cap_drop: ALL` y solo
  `NET_BIND_SERVICE` (necesaria para escuchar en <1024).
- **Certificados persistentes** en los volúmenes `mercaldas_caddy_data` /
  `mercaldas_caddy_config` (no se re-emiten en cada `up`).
- El **API sí es público** (en `HOST_API`): los fronts son SPA y llaman al
  backend desde el navegador. Se protege con TLS y con el firewall, no con un
  puerto abierto.

Además (endurecimiento por defecto):

- **El contenedor NO corre como root**: hay un usuario `merc` creado en la
  imagen y Caddy escucha en `8080`/`8443` (el compose los publica como
  `80`/`443`). Ya no hace falta `NET_BIND_SERVICE`.
- **`PROTECT_ADMIN=true` por defecto** y **fail-closed**: si está activo y no
  hay `ADMIN_PASSWORD`/`ADMIN_PASSWORD_HASH`, el contenedor **no arranca** (así
  no quedan paneles abiertos por descuido).
- **`/bot` protegido por defecto** (`PROTECT_BOT=true`, mismas credenciales):
  consume crédito de DeepSeek y ninguna interfaz de este repo lo consume hoy.
- **Rate limit propio** (sin dependencias): `RATE_LIMIT_ENABLED=true` limita
  `/auth/*` y `/customer-auth/*` por IP (requiere `TRUST_PROXY=loopback`, ya
  definido en el compose) y el bot limita `/chat` y `/cart*`.
- **Cabeceras añadidas**: `Content-Security-Policy` (ajustable con `CSP_POLICY`),
  `Permissions-Policy` y `Cross-Origin-Opener-Policy`.
- **Límite de tamaño de cuerpo** en el borde (`MAX_REQUEST_BODY`, def. `50MB`).
- **API de administración de Caddy desactivada** (`admin off`).
- **Rotación de logs** de Docker (`max-size 10m`, `max-file 5`) para no llenar
  el disco, y volumen `mercaldas_media` para los medios locales del backend.
- **`TLS=false` requiere `ALLOW_INSECURE=true`**: no se sirve HTTP en claro por
  descuido.
- **BD y OSRM bindeados a `127.0.0.1`** en sus compose (`db/docker`,
  `delivery-routing`): dejan de publicarse en `0.0.0.0`.

---

## 2. Requisitos en Windows

### Windows 10/11 Pro/Enterprise
Instala **Docker Desktop** con backend **WSL2** y ejecuta los comandos desde
PowerShell o Git Bash.

### Windows Server (2019/2022/2025)
Docker Desktop **no** está soportado en Windows Server. La vía práctica es:

```powershell
# 1) Habilitar WSL2
wsl --install                 # instala WSL2 + una distro (p. ej. Ubuntu)
wsl --set-default-version 2
```

Dentro de la distro (Ubuntu), instala **Docker Engine + compose plugin**:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER    # vuelve a entrar para aplicar el grupo
docker version
```

Los contenedores son Linux, así que corren igual dentro de WSL2. Ejecuta
`docker compose` desde la distro (WSL) apuntando a la carpeta del repo.

### Firewall (solo 80 y 443)
En PowerShell **como administrador**:

```powershell
New-NetFirewallRule -DisplayName "Mercaldas HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "Mercaldas HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

**No** abras `3100`, `8001`, `5432` ni `5000`: son internos.

---

## 3. Puesta en marcha

```bash
cd <repo>
cp docker/.env.example docker/.env         # edita dominios, TLS y secretos

# VITE_API_URL se hornea en los fronts: pásalo igual que en docker/.env
docker compose -f docker/docker-compose.yml build \
  --build-arg VITE_API_URL=https://api.tudominio.com

docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs -f app
```

En `docker/.env` configura, como mínimo:

| Variable | Ejemplo | Notas |
|---|---|---|
| `HOST_API` | `api.tudominio.com` | URL del API |
| `HOST_WEB` | `client.tudominio.com` | interfaz cliente |
| `HOST_ADMIN` | `admin.tudominio.com` | panel admin |
| `HOST_PICKING_ADMIN` | `picking-admin.tudominio.com` | picking admin |
| `HOST_DELIVERY_ADMIN` | `delivery-admin.tudominio.com` | delivery admin |
| `TLS` / `ACME_EMAIL` | `true` / `admin@…` | Let's Encrypt |
| `VITE_API_URL` | `https://api.tudominio.com` | debe coincidir con `HOST_API` |
| `DATABASE_URL` | `postgres://…` | externa o contenedor de `db/docker` |
| `JWT_SECRET`, `CLOUDINARY_*`, `DEEPSEEK_API_KEY` | — | secretos |
| `PROTECT_ADMIN` | `true` | Basic Auth en los paneles (**por defecto true**, fail-closed) |
| `ADMIN_PASSWORD` | — | contraseña del Basic Auth (obligatoria si `PROTECT_ADMIN`) |
| `PROTECT_BOT` | `true` | Basic Auth en `/bot` (def. true; ponlo `false` si conectas un front al bot) |
| `MAX_REQUEST_BODY` | `50MB` | tamaño máximo de cuerpo en el borde (`0` = sin límite) |
| `CSP_POLICY` | (def.) | política CSP; `off` la desactiva |
| `ALLOW_INSECURE` | `false` | requerido para permitir `TLS=false` |

> `CLOUDINARY_*` son **obligatorias**: sin ellas el backend aborta al arrancar
> (`Cloudinary credentials are required`) y el contenedor entra en bucle de
> reinicio.

Deja vacío (o borra) el `HOST_*` de una interfaz que **no** quieras publicar.

---

## 4. DNS y router

- Un registro **A** por cada `HOST_*` → IP pública del servidor.
- Reenvía en el router/firewall **solo** TCP `80` y `443` a este host.
- Con `TLS=true`, Caddy emite los certificados al primer arranque (necesita que
  80/443 lleguen al servidor).

---

## 5. Base de datos

La BD no va en este contenedor. Opciones:

- **Administrada/remota**: pon su cadena en `DATABASE_URL`.
- **Contenedor de `db/docker`** en la red interna:

  ```bash
  docker network connect mercaldas_internal ecommerce_postgres
  # DATABASE_URL=postgres://postgres:postgres@ecommerce_postgres:5432/ecommerce
  ```

Nunca publiques `5432` al host.

---

## 6. Validar que solo se expone lo necesario

```bash
# Puertos publicados del contenedor: deben ser SOLO 80 y 443
docker compose -f docker/docker-compose.yml ps
docker port mercaldas-app-1

# Desde fuera: el backend NO debe responder en su puerto interno
curl -sS -m 3 http://<IP_DEL_SERVIDOR>:3100/ || echo "OK: 3100 cerrado"
curl -sS -m 3 http://<IP_DEL_SERVIDOR>:8001/ || echo "OK: 8001 cerrado"

# Interfaces (con DNS real, o forzando el host hacia la IP)
curl -I https://client.tudominio.com
curl -I -u admin:secreto123 https://admin.tudominio.com   # si PROTECT_ADMIN=true
```

Comprobación sin DNS (antes de publicar dominios):

```bash
curl -I --resolve client.tudominio.com:443:<IP_DEL_SERVIDOR> https://client.tudominio.com
```

---

## 7. Cómo funciona el enrutado

`docker/entrypoint.sh` genera el Caddyfile en runtime con
`docker/gen-caddyfile.mjs` a partir de los `HOST_*`:

- `HOST_API` → `/bot/*` al bot (`127.0.0.1:8001`) y el resto al backend
  (`127.0.0.1:3100`).
- Cada `HOST_<APP>` → estáticos del front correspondiente (`/srv/<app>`) con
  *fallback* SPA a `index.html`.

Con `TLS=false` los vhosts se generan como `http://<host>` (si no, un hostname
sin esquema haría que Caddy asuma HTTPS y escuche en `:443` en lugar de `:80`).

Regenerar/validar sin arrancar todo:

```bash
HOST_API=api.example.com HOST_WEB=client.example.com \
  PROTECT_ADMIN=true ADMIN_PASSWORD=secreto \
  CADDYFILE_OUT=/tmp/Caddyfile node docker/gen-caddyfile.mjs
docker run --rm -v /tmp/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2.9.1 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

---

## 8. Operación

```bash
# Reconstruir tras cambios de código
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up -d

# Cambiar un dominio NO requiere rebuild: edita docker/.env y `up -d`.
# Cambiar VITE_API_URL SÍ requiere rebuild (va dentro del bundle de los fronts).

docker compose -f docker/docker-compose.yml logs -f app
docker compose -f docker/docker-compose.yml down       # conserva volúmenes
docker compose -f docker/docker-compose.yml down -v    # borra también certs/BD montada
```

---

## 9. Problemas típicos

| Síntoma | Causa / solución |
|---|---|
| Bucle de reinicio del contenedor | Falta `CLOUDINARY_*` (obligatorias) u otro secreto; revisa `logs -f app`. |
| `entrypoint.sh: /usr/bin/env: 'bash\r'` | El clon quedó en CRLF. La imagen lo normaliza con `sed`, pero si editas el `.sh` en Windows, guárdalo con **LF**. |
| Caddy no emite certificados | 80/443 no llegan al host (firewall/router) o el DNS no apunta a la IP. Revisa `docker compose … logs app`. |
| Un front no carga | Falta su `HOST_*` o `VITE_API_URL` no coincide con `HOST_API` al compilar. |
| El navegador da CORS | `CORS_ORIGIN` debe incluir las URLs de las interfaces (se deriva solo de los `HOST_*` si lo dejas vacío). |
| No conecta a la BD | `DATABASE_URL` incorrecta o el contenedor de BD no está en `mercaldas_internal`. |
| Docker no responde | En Windows, arranca Docker Desktop (`docker desktop start`) o el daemon en WSL (`sudo service docker start`). |

---

## 10. Checklist de primer despliegue

- [ ] Docker + compose disponibles (`docker compose version`).
- [ ] `docker/.env` creado y con dominios, TLS, `DATABASE_URL` y secretos.
- [ ] DNS `A` de todos los `HOST_*` → IP pública.
- [ ] Firewall/router: solo 80 y 443 abiertos.
- [ ] `build` + `up -d` sin errores.
- [ ] `docker port` muestra **solo** 80 y 443.
- [ ] `https://<HOST_API>/api-status` responde.
- [ ] Cada interfaz carga y llama al API sin errores de CORS.
- [ ] Paneles de administración protegidos (`PROTECT_ADMIN=true` + `ADMIN_PASSWORD`).
- [ ] `/bot` responde `401` sin credenciales (si `PROTECT_BOT=true`).
- [ ] `3100`, `8001` y `5432` **no** son accesibles desde fuera.
- [ ] `docker port` publica **solo** 80 y 443 (el contenedor escucha 8080/8443).
