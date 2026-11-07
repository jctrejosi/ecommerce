# Despliegue en Docker (un contenedor por servicio) — guía del servidor

Proyecto compose **`ecommerce`**: cada parte del stack corre en su propio
contenedor, con reinicio y healthcheck independientes.

| Contenedor | Escucha en | Expuesto a internet |
|---|---|---|
| `ecommerce_db` (PostGIS) | `127.0.0.1:5432` (solo host) | ❌ nunca |
| `ecommerce_backend` (NestJS) | `:3100` (red interna) | ❌ nunca directamente |
| `ecommerce_bot` (FastAPI) | `:8001` (red interna) | ❌ nunca directamente |
| `ecommerce_client` (SPA, nginx) | `:8080` (red interna) | ❌ |
| `ecommerce_admin` (SPA, nginx) | `:8080` (red interna) | ❌ |
| `ecommerce_delivery` (SPA, nginx) | `:8080` (red interna) | ❌ |
| `ecommerce_picking` (SPA, nginx) | `:8080` (red interna) | ❌ |
| `ecommerce_proxy` (Caddy) | `127.0.0.1:30180` | ❌ (lo alcanza el edge) |
| `ecommerce_osrm` | `:5000` (red interna) | ❌ |
| **`edge_caddy`** (compartido) | `80` / `443` | ✅ **único** |

Los archivos viven en `docker/` (`Dockerfile` multi-target, `docker-compose.yml`,
`gen-caddyfile.mjs`, `backend-entrypoint.sh`, `proxy-entrypoint.sh`,
`nginx.conf`, `.env.example`).

Interfaces incluidas (build Vite): `Interface web client` (`HOST_WEB`),
`Interface web admin` (`HOST_ADMIN`), `Interface web picking admin`
(`HOST_PICKING_ADMIN`) y `Interface web delivery admin`
(`HOST_DELIVERY_ADMIN`). Las apps **Expo** (delivery/picking móvil) no se sirven
en este contenedor: se compilan a APK/IPA apuntando a `HOST_WEB`, que sirve el
API en el mismo origen (y también `/discovery`).

> Nota: `Interface web picking/` y `Interface web analytics/` existen en el repo
> pero **no tienen proyecto** (solo `node_modules`/`.vite` rastreados por error);
> por eso no se compilan ni se sirven.

> Este despliegue es independiente del `Dockerfile`/`Caddyfile` de la raíz (que
> son para Render). No se afectan entre sí.

---

## 1. Modelo de seguridad

- **Partición de puertos**: los proyectos no compiten por 80/443. Cada uno usa
  puertos propios (ecommerce `30180`, CRM `30280`) publicados **solo en
  `127.0.0.1`**, y un **edge compartido** (`docker/edge/`) es el único que
  publica `80`/`443` y hace TLS. Backend, bot, fronts y BD viven en
  `ecommerce_internal` (`internal: true`); backend y bot además salen por
  `ecommerce_edge` para hablar con APIs externas.
- **TLS** en el edge con el certificado de origen de Cloudflare; HSTS activado.
- **Cabeceras de seguridad** en todos los vhosts: `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, y se elimina la cabecera `Server`.
- **Basic Auth opcional** en los paneles de administración
  (`PROTECT_ADMIN=true` protege `HOST_ADMIN`, `HOST_PICKING_ADMIN` y
  `HOST_DELIVERY_ADMIN`).
- **Endurecimiento del contenedor**: `no-new-privileges`, `cap_drop: ALL` y solo
  `NET_BIND_SERVICE` (necesaria para escuchar en <1024).
- **Estado de Caddy persistente** en los volúmenes `ecommerce_caddy_data` /
  `ecommerce_caddy_config`.
- El **API es público**, pero se sirve en el **mismo origen que `HOST_WEB`**
  (rutas `/catalog/*`, `/orders`, `/static/*`, `/socket.io/*`, `/bot/*`, …).
  Los paneles lo consumen cross-origin y CORS solo autoriza sus orígenes.
  `HOST_API` queda como alias **solo para `/webhooks/*`** (pasarelas de pago);
  no publica el resto del backend.

Además (endurecimiento por defecto):

- **El contenedor NO corre como root**: hay un usuario `merc` creado en la
  imagen y Caddy escucha en `8080`/`8443` (el compose los publica como
  `80`/`443`). Ya no hace falta `NET_BIND_SERVICE`.
- **`PROTECT_ADMIN=true` por defecto** y **fail-closed**: si está activo y no
  hay `ADMIN_PASSWORD`/`ADMIN_PASSWORD_HASH`, el contenedor **no arranca** (así
  no quedan paneles abiertos por descuido).
- **El bot no se publica en Caddy**: el backend proxya `/bot/*` hacia
  `127.0.0.1:8001` por loopback dentro del contenedor. Así el bot no tiene
  superficie externa propia y conserva su rate limit interno.
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

### Windows Server (2019/2022/2025) — configuración usada en este VPS

Docker Desktop **no** sirve como servicio: el motor se detiene cuando se cierra
la sesión RDP del usuario que lo lanzó. En su lugar, el motor vive en una distro
WSL propia y arranca con `systemd` desde una tarea de sistema.

```powershell
# 1) Instalar WSL2 + Ubuntu (sin lanzarla)
wsl --install -d Ubuntu --no-launch
```

```bash
# 2) Motor dentro de Ubuntu WSL (script del repo, idempotente)
wsl -d Ubuntu -u root -- bash /mnt/c/.../ecommerce/scripts-agent/wsl-docker-setup.sh
```

El script instala `docker.io` + `docker-compose-v2`, habilita `systemd`, deja la
API Docker en **loopback** (`127.0.0.1:2375`, nunca en LAN) y arranca el motor.

**Persistencia (sin depender de sesiones):**

| Tarea programada | Principal | Qué hace |
|---|---|---|
| `MercaldasDockerEngine` | `Desarrolo4`, S4U, al inicio | `wsl -d Ubuntu -u root -- sleep infinity` mantiene la distro y con ella `systemd` + Docker |
| `MercaldasPortProxy` | `Desarrolo4`, S4U, al inicio | recalcula la IP de WSL y reescribe `portproxy` 80/443 |

`S4U` no guarda contraseña. Las distros WSL son **por usuario**: una tarea como
`SYSTEM` no las ve.

```powershell
# 3) Publicar 80/443 del contenedor edge en las interfaces de Windows
#    (WSL2 NAT solo expone loopback; la IP de WSL cambia al reiniciar)
$ip = (wsl -d Ubuntu -u root -- hostname -I).Split(' ')[0]
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=80  connectaddress=$ip connectport=80
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=443 connectaddress=$ip connectport=443
```

El script `scripts-agent/wsl-portproxy.ps1` hace esto automáticamente al
arrancar. **No** uses `networkingMode=mirrored`: Windows Server 2022 no lo
soporta (WSL revierte a NAT).

Como los compose usan bind mounts (`Caddyfile`, `init.sql`), en este servidor
`prod.js` debe ejecutarse **dentro de WSL**. Usa el lanzador `prod.cmd` (que
resuelve la ruta con `wslpath` y llama a `node prod.js` dentro de Ubuntu).

```powershell
.\prod.cmd --with-db
.\prod.cmd --status
```

### Firewall (solo 80 y 443)
En PowerShell **como administrador**:

```powershell
New-NetFirewallRule -DisplayName "Mercaldas HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "Mercaldas HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

**No** abras `3100`, `8001`, `5432` ni `5000`: son internos.

---

## 3. Puesta en marcha

> Atajo: `node prod.js` hace lo de abajo (sincroniza `docker/.env` desde
> `prod.config.json`, valida secretos y construye/levanta). `node prod.js --with-db`
> levanta además la BD. `node prod.js --dns` imprime los registros DNS/firewall.
> Los comandos manuales equivalen a:

```bash
cd <repo>
cp docker/.env.example docker/.env         # edita dominios, TLS y secretos

# VITE_API_URL se hornea en los fronts y se toma de docker/.env.
docker compose -f docker/docker-compose.yml --env-file docker/.env build

docker compose -f docker/docker-compose.yml --env-file docker/.env up -d
docker compose -f docker/docker-compose.yml --env-file docker/.env ps
docker compose -f docker/docker-compose.yml --env-file docker/.env logs -f backend
```

En `docker/.env` configura, como mínimo:

| Variable | Ejemplo | Notas |
|---|---|---|
| `HOST_WEB` | `client.tudominio.com` | interfaz cliente **y API same-origin** |
| `HOST_ADMIN` | `admin.tudominio.com` | panel admin |
| `HOST_PICKING_ADMIN` | `picking-admin.tudominio.com` | picking admin |
| `HOST_DELIVERY_ADMIN` | `delivery-admin.tudominio.com` | delivery admin |
| `HOST_API` | `api.tudominio.com` | **opcional**: alias solo para `/webhooks/*` |
| `TLS` / `ACME_EMAIL` | `true` / `admin@…` | Let's Encrypt |
| `VITE_API_URL` | `https://client.tudominio.com` | debe coincidir con `HOST_WEB` |
| `VITE_GOOGLE_CLIENT_ID` | `123-abc.apps.googleusercontent.com` | client ID público; sin él el botón de Google queda deshabilitado |
| `VITE_GOOGLE_REDIRECT_URI` | `https://client.tudominio.com` | opcional; por defecto usa el origen HTTPS actual |
| `DATABASE_URL` | `postgres://…` | externa o contenedor de `db/docker` |
| `JWT_SECRET`, `CLOUDINARY_*`, `DEEPSEEK_API_KEY` | — | secretos |
| `PROTECT_ADMIN` | `true` | Basic Auth en los paneles (**por defecto true**, fail-closed) |
| `ADMIN_PASSWORD` | — | contraseña del Basic Auth (obligatoria si `PROTECT_ADMIN`) |
| `MAX_REQUEST_BODY` | `50MB` | tamaño máximo de cuerpo en el borde (`0` = sin límite) |
| `CSP_POLICY` | (def.) | política CSP; `off` la desactiva |
| `ALLOW_INSECURE` | `false` | requerido para permitir `TLS=false` |

> Con `MEDIA_STORAGE=local` (recomendado en este VPS) las imágenes se guardan en
> el volumen `mercaldas_media` y **no hace falta Cloudinary**. Si eliges
> `MEDIA_STORAGE=cloudinary`, entonces `CLOUDINARY_*` son obligatorias: sin
> ellas el backend aborta (`Cloudinary credentials are required`).

Deja vacío (o borra) el `HOST_*` de una interfaz que **no** quieras publicar.

---

## 4. DNS, TLS y Cloudflare

Producción actual: zona `jcti.xyz`, servidor **`169.58.255.64`**, DNS y proxy en
**Cloudflare** (el registrador sigue siendo GoDaddy, pero los nameservers ya son
los de Cloudflare).

### 4.1 Registros DNS

Todos **proxied** (nube naranja):

| Tipo | Nombre | Valor | Interfaz |
|---|---|---|---|
| A | `ecommerce` | `169.58.255.64` | tienda web (`HOST_WEB`) |
| A | `ecommerce-api` | `169.58.255.64` | API/backend (`HOST_API`) |
| A | `ecommerce-admin` | `169.58.255.64` | panel admin |
| A | `ecommerce-picking` | `169.58.255.64` | picking admin |
| A | `ecommerce-delivery` | `169.58.255.64` | delivery admin |
| A | `mercaldas*` (5) | `169.58.255.64` | **alias heredados** (`HOST_*_LEGACY`) |

Los alias `mercaldas`/`mercaldas-api`/… siguen sirviendo el mismo contenido para
no romper APKs ya instaladas, Google OAuth ni URLs de Wompi configuradas.
Cuando todo apunte a `ecommerce*`, se pueden borrar del `.env` y del DNS.

> ⚠️ **Los hosts deben ser de UN SOLO nivel bajo `jcti.xyz`.** El certificado
> *Universal SSL* (gratis) cubre `jcti.xyz` y `*.jcti.xyz`; un nombre de dos
> niveles como `api.ecommerce.jcti.xyz` **no recibe certificado en el borde** y
> el handshake TLS falla (`ssl alert 40`). Para dos niveles haría falta *Total
> TLS* (Advanced Certificate Manager, de pago). De ahí `ecommerce-api…`.

### 4.2 TLS en el origen

El edge (`docker/edge/`) **no usa ACME**: sirve un **certificado de origen de
Cloudflare** (15 años) desde `/etc/mercaldas/edge-tls/{origin.pem,origin.key}`,
montado de solo lectura en `/etc/caddy/edge-tls`. Cloudflare lo valida en modo
**Full (strict)**. Si un registro se pone en gris (DNS only), el navegador dará
error de certificado: ese certificado no lo confía ningún navegador.

### 4.3 Origen cerrado a Cloudflare

`docker/edge/cloudflare-origin-firewall.sh` + su unit systemd
(`cloudflare-origin-firewall.service`) dejan `80`/`443` accesibles **solo**
desde los rangos de Cloudflare. Se aplica en la cadena **`DOCKER-USER`** porque
los puertos publicados por Docker entran por `FORWARD` y **no pasan por las
reglas INPUT de `ufw`**. `ufw` mantiene la misma política para cualquier
servicio que no vaya por Docker. Resultado: golpear la IP del servidor en
80/443 no responde.

### 4.4 Ajustes de Cloudflare (panel, no automatizables con el token actual)

- SSL/TLS → Overview: **Full (strict)**.
- SSL/TLS → Edge Certificates: **Always Use HTTPS ON**, **Minimum TLS 1.2**,
  **TLS 1.3 ON**, **Automatic HTTPS Rewrites ON**.
- **Rocket Loader OFF** (rompe las SPAs).
- **Bot Fight Mode OFF** (bloquearía webhooks de Wompi/ePayco y las apps
  móviles, que no mandan `Origin`).
- Network: **WebSockets ON** (chat/socket.io).
- Caching → Cache Rules: **bypass** para `ecommerce-api.jcti.xyz/*` y para
  `*/index.html` (si no, un `index` cacheado apunta a bundles viejos).

- El **proxy interno no hace TLS**: el edge compartido es siempre el que
  termina el TLS del origen.

---

## 5. Base de datos

La BD **es el servicio `db`** del propio proyecto (contenedor `ecommerce_db`):

```bash
DATABASE_URL=postgres://postgres:postgres@db:5432/ecommerce
```

Se publica **solo en `127.0.0.1`** (`DB_PUBLISH_PORT`, def. `5432`) para scripts
del host; nunca en `0.0.0.0`. El volumen `db_postgres_data` conserva los datos
heredados del antiguo proyecto `db`.

**OSRM** (rutas de delivery) también es un servicio del proyecto (`osrm`): el
backend lo resuelve por DNS interno y no se publica ningún puerto.

```bash
OSRM_URL=http://osrm:5000
```

Si no usas el mapa de rutas, quita el servicio `osrm` del compose: el resto
funciona igual.

---

## 6. Validar que solo se expone lo necesario

```bash
# Puertos: solo la BD y el proxy en loopback; el edge es quien publica 80/443
docker compose -f docker/docker-compose.yml ps
docker port ecommerce_proxy      # espera 127.0.0.1:30180->8080 (nada en 0.0.0.0)
docker port ecommerce_db         # espera 127.0.0.1:5432->5432
docker port edge_caddy           # espera 0.0.0.0:80->80 y 0.0.0.0:443->443

# Desde fuera: el backend NO debe responder en su puerto interno
curl -sS -m 3 http://<IP_DEL_SERVIDOR>:3100/ || echo "OK: 3100 cerrado"
curl -sS -m 3 http://<IP_DEL_SERVIDOR>:8001/ || echo "OK: 8001 cerrado"
curl -sS -m 3 http://<IP_DEL_SERVIDOR>:30180/ || echo "OK: 30180 cerrado"

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

`ecommerce_proxy` genera el Caddyfile en runtime con
`docker/gen-caddyfile.mjs` a partir de los `HOST_*`:

- `HOST_WEB` → contenedor `client` **y** proxy same-origin de las rutas del
  API (`/catalog/*`, `/orders`, `/static/*`, `/socket.io/*`, `/bot/*`,
  `/discovery`, …) al backend (`backend:3100`).
- `HOST_API` → **todo el API** al backend (incluye `/webhooks/*`; la raíz se
  reescribe a `/webhooks/wompi`). Si no defines `HOST_API`, no se publica.
- Cada `HOST_<APP>` restante → su contenedor `admin` / `picking` / `delivery`
  (SPA con *fallback* a `index.html` en nginx). Los paneles llaman al API en
  `HOST_WEB` o `HOST_API` (cross-origin autorizado por `CORS_ORIGIN`).
- `HOST_*_LEGACY` añade hosts adicionales que sirven exactamente lo mismo
  (se usa para mantener `mercaldas*` durante la migración).

Los vhosts se generan siempre como `http://<host>`: el proxy no hace TLS, lo
termina el edge compartido.

Regenerar/validar sin arrancar todo:

```bash
HOST_WEB=client.example.com HOST_ADMIN=admin.example.com \
  PROTECT_ADMIN=true ADMIN_PASSWORD=secreto \
  CADDYFILE_OUT=/tmp/Caddyfile node docker/gen-caddyfile.mjs
docker run --rm -v /tmp/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2.9.1 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

---

## 8. Operación

`node prod.js` comprueba antes de construir que los puertos publicados
(`30180` para el proxy y `5432` para la BD) estén libres o sean del
propio contenedor (`ecommerce_proxy`). Si otro proceso o contenedor los ocupa,
aborta sin construir y muestra quién los tiene (`nombre · PID` + comando), o el
contenedor en conflicto. Para ejecutar solo esa comprobación:

```bash
node prod.js --check-ports
```

```bash
# Reconstruir tras cambios de código
docker compose -f docker/docker-compose.yml --env-file docker/.env build
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d

# Cambiar un dominio NO requiere rebuild: edita docker/.env y `up -d`.
# Cambiar VITE_API_URL SÍ requiere rebuild (va dentro del bundle de los fronts).

docker compose -f docker/docker-compose.yml --env-file docker/.env logs -f backend
docker compose -f docker/docker-compose.yml --env-file docker/.env down       # conserva volúmenes
docker compose -f docker/docker-compose.yml --env-file docker/.env down -v    # borra TODO (incluye la BD)
```

---

## 9. Problemas típicos

| Síntoma | Causa / solución |
|---|---|
| Bucle de reinicio del backend | Falta `CLOUDINARY_*` (obligatorias) u otro secreto; revisa `logs -f backend`. |
| Bucle de reinicio del proxy | `PROTECT_ADMIN=true` sin `ADMIN_PASSWORD` (fail-closed) o hosts mal formados; revisa `logs -f proxy`. |
| `entrypoint.sh: /usr/bin/env: 'bash\r'` | El clon quedó en CRLF. La imagen lo normaliza con `sed`, pero si editas el `.sh` en Windows, guárdalo con **LF**. |
| Caddy no emite certificados | Modo directo: 80/443 no llegan al host o el DNS no apunta a la IP. Con Cloudflare delante **no aplica**: el edge sirve el certificado de origen (§4.2). |
| Un front no carga | Falta su `HOST_*` o `VITE_API_URL` no coincide con `HOST_WEB` al compilar. |
| El navegador da CORS | `CORS_ORIGIN` debe incluir las URLs de las interfaces (se deriva solo de los `HOST_*` si lo dejas vacío). |
| No conecta a la BD | `DATABASE_URL` incorrecta o el contenedor `db` no está sano (`docker logs ecommerce_db`). |
| Docker no responde | `systemctl status docker` (servidor Debian). En el VPS Windows antiguo: `wsl -d Ubuntu -u root -- systemctl status docker`. |

---

## 10. Checklist de primer despliegue

- [ ] Docker + compose disponibles (`docker compose version`).
- [ ] `docker/.env` creado y con dominios (`HOST_*` y `*_LEGACY`), `DATABASE_URL` y secretos.
- [ ] DNS `A` de todos los `HOST_*` → IP pública.
- [ ] Firewall/router: solo 80 y 443 abiertos.
- [ ] `build` + `up -d` sin errores.
- [ ] `docker port ecommerce_proxy` muestra solo `127.0.0.1:30180` (nada en `0.0.0.0`).
- [ ] Edge levantado (`docker/edge/`) y `docker port edge_caddy` publica 80 y 443.
- [ ] `https://<HOST_WEB>/api-status` responde.
- [ ] `https://<HOST_WEB>/discovery` devuelve `mercaldas-backend`.
- [ ] `https://<HOST_API>/api-status` responde (el host del API sirve todo el backend).
- [ ] Cada interfaz carga y llama al API sin errores de CORS.
- [ ] Paneles de administración protegidos (`PROTECT_ADMIN=true` + `ADMIN_PASSWORD`).
- [ ] `/bot/health` responde a través del backend (el bot ya no está expuesto por Caddy).
- [ ] `3100`, `8001`, `5432` y `30180` **no** son accesibles desde fuera.
- [ ] `curl -k https://<IP_DEL_SERVIDOR>/` **no** responde (origen cerrado a Cloudflare).
- [ ] `docker exec ecommerce_backend curl -s -o /dev/null -w '%{http_code}' https://www.google.com` → `200` (salida a internet intacta).

---

## 11. Servidor de producción actual y CI/CD

### 11.1 Servidor

| Dato | Valor |
|---|---|
| IP | `169.58.255.64` |
| SO | Debian 12, Docker nativo (no WSL) |
| Acceso | `ssh prod` → usuario `deploy` (llave `id_ed25519_prod`), `sudo` sin contraseña, en el grupo `docker` |
| Red de administración | Tailscale (`srv-prod`) |
| Repo | `/home/deploy/ecommerce` (rama `dev`) |
| Secretos | `docker/.env` (600, no versionado) |
| Servicios | `ecommerce_db`, `ecommerce_backend`, `ecommerce_bot`, `ecommerce_client`, `ecommerce_admin`, `ecommerce_delivery`, `ecommerce_picking`, `ecommerce_proxy`, `ecommerce_osrm`, `edge_caddy` |

Todos los servicios van con `restart: unless-stopped` y `docker.service` está
`enabled`: el stack vuelve solo tras un reinicio del servidor.

### 11.2 Despliegue manual

```bash
cd /home/deploy/ecommerce
git pull --ff-only \
  && sudo docker compose -f docker/docker-compose.yml --env-file docker/.env build \
  && sudo docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --remove-orphans
# o el script idempotente, que además valida el healthcheck, sincroniza el site
# del edge y recarga Caddy:
bash deploy/deploy.sh
```

`node prod.js` sincroniza `docker/.env` desde `prod.config.json` (hosts, TLS,
URLs, puertos) y reconstruye la imagen con el `VITE_API_URL` correcto.

### 11.3 CI/CD (GitHub Actions)

`.github/workflows/ci-cd.yml`: **CI** construye la imagen en cada push/PR a
`master`/`dev`; **deploy** corre en pushes a `dev` sobre un runner self-hosted
y ejecuta `deploy/deploy.sh`.

Para dejarlo activo hacen falta dos pasos **en GitHub** (una sola vez):

1. **Deploy key** (para que `git fetch` funcione en el servidor): repo →
   *Settings → Deploy keys → Add deploy key*, pegar
   `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEH8w4i/9FOM2IefoB99Djwu3gnr3NX7UZht2G7URJis srv-prod-github`
   (solo lectura).
2. **Runner self-hosted**: repo → *Settings → Actions → Runners → New
   self-hosted runner* (Linux x64) y en el servidor:

   ```bash
   cd /home/deploy/ecommerce
   sudo RUNNER_USER=deploy bash deploy/install-runner.sh <TOKEN>
   ```

   El workflow espera labels `self-hosted, linux, mercaldas` y
   `DEPLOY_PATH=/home/deploy/ecommerce` (variable de repositorio).
