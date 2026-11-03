# SECURITY — Especificación de seguridad (contenedor único)

Documento de referencia del **modelo de seguridad** del despliegue de Mercaldas
en un contenedor único (`docker/`). Describe qué se protege, cómo, con qué
valores concretos, cómo verificarlo y **qué NO queda cubierto**.

> Ámbito: la imagen `docker/Dockerfile` (backend NestJS + bot FastAPI +
> interfaces web + Caddy) y su `docker-compose.yml`. No aplica al
> `Dockerfile`/`Caddyfile` de la raíz, que son para Render.

---

## 1. Superficie expuesta

Principio: **un solo proceso habla con internet (Caddy); nada más se publica.**

| Proceso | Escucha en | Publicado | Notas |
|---|---|---|---|
| Caddy interno (proxy + TLS + estáticos) | `:8080` (HTTP) / `:8443` (HTTPS) | `127.0.0.1:30180` / `127.0.0.1:30181` | lo alcanza el edge (red `shared_edge`) |
| **Edge compartido** (`docker/edge/`, otro contenedor) | `:80` / `:443` | **Sí** → solo Cloudflare | único punto de entrada; TLS con certificado de origen (§1.1) |
| Backend NestJS | `127.0.0.1:3100` | ❌ | loopback dentro del contenedor |
| Bot FastAPI | `127.0.0.1:8001` | ❌ | loopback dentro del contenedor |
| PostgreSQL | red `mercaldas_internal` (`internal: true`) | ❌ | sin ruta a internet |

- El contenedor **no corre como root**: usuario `merc` (uid/gid 10001). Por eso
  Caddy escucha en puertos altos.
- Redes: `mercaldas_edge` (salida a internet y puertos publicados),
  `mercaldas_internal` (**sin** ruta a internet) para la BD/ERP y `shared_edge`
  (red compartida con el edge).
- Los puertos de cada proyecto son PROPIOS y solo en `127.0.0.1` (ecommerce
  `30180/30181`): no compiten con 80/443 ni con servicios «genéricos».
- Servidor de producción actual: **Debian 12** (`169.58.255.64`), Docker nativo.
  SSH solo con llave (22), `ufw` deny-in por defecto, `fail2ban`, swap 20 GB y
  `unattended-upgrades`. Administración además por **Tailscale**.
- Modo directo (un solo proyecto en el servidor): `PUBLIC_HTTP_PORT=80`,
  `PUBLIC_HTTPS_PORT=443` y `TLS=true`.

### 1.1 Borde de producción: Cloudflare delante, origen cerrado

- **DNS + proxy en Cloudflare** (nube naranja en todos los registros). El
  navegador habla con Cloudflare; Cloudflare habla con el origen.
- **TLS origen**: certificado de origen de Cloudflare (15 años) en
  `/etc/mercaldas/edge-tls/`, montado de solo lectura. Modo **Full (strict)**.
  Sin proxy naranja el navegador no confía en esa CA (es correcto).
- **Restricción por IP**: `cloudflare-origin-firewall.service` carga
  `docker/edge/cloudflare-origin-firewall.sh`, que en la cadena **`DOCKER-USER`**
  deja 80/443 solo a los rangos de Cloudflare y descarta el resto. Es necesario
  porque los puertos publicados por Docker entran por `FORWARD` y **no pasan por
  las reglas INPUT de `ufw`**. `ufw` replica la política para servicios fuera de
  Docker. Verificación: `curl -k https://<IP_DEL_SERVIDOR>/` **no** responde.
- **Un solo nivel de subdominio** bajo `jcti.xyz`: el *Universal SSL* gratuito
  cubre `jcti.xyz` y `*.jcti.xyz`. Un `api.mercaldas.jcti.xyz` no recibe
  certificado en el borde (handshake TLS falla). Por eso los hosts son
  `mercaldas`, `mercaldas-api`, `mercaldas-admin`, `mercaldas-picking`,
  `mercaldas-delivery`.
- **Webhooks** (Wompi/ePayco) y **apps móviles** deben apuntar al host del API
  (`https://mercaldas-api.jcti.xyz`). Las apps nativas no envían `Origin`, por
  eso no se puede activar *Bot Fight Mode* ni exigir preflight.

## 2. Transporte y TLS

- **Let's Encrypt automático** vía Caddy cuando `TLS=true` (por defecto).
  Requiere que 80 y 443 lleguen al servidor y que el DNS apunte a él.
  (**No** es el caso del despliegue actual: con Cloudflare delante, el origen
  sirve el certificado de origen de Cloudflare y Let's Encrypt queda sin uso.)
- **Certificados persistentes** en los volúmenes `mercaldas_caddy_data` /
  `mercaldas_caddy_config` (no se re-emiten en cada `up`).
- **HSTS**: `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- **`TLS=false` es fail-closed**: el contenedor **no arranca** salvo que se
  acepte explícitamente con `ALLOW_INSECURE=true` (y entonces avisa por stderr).
  Nunca debe usarse en producción: expone credenciales y tokens en claro.
- El correo ACME se configura con `ACME_EMAIL`.

## 3. Cabeceras de seguridad

Se aplican **en todos los vhosts** (API, interfaces y smoke-test), y se elimina
la cabecera `Server`:

| Cabecera | Valor |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (solo con TLS) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` |
| `Permissions-Policy` | `camera=(self), microphone=(self), geolocation=(self), payment=(self)` |
| `Content-Security-Policy` | política por defecto (abajo) |

**CSP por defecto** (`gen-caddyfile.mjs`):

```
default-src 'self';
script-src 'self' 'unsafe-inline' https:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' data: https:;
connect-src 'self' https: wss:;
frame-src 'self' https:;
object-src 'none';
base-uri 'self';
frame-ancestors 'self';
form-action 'self' https:
```

Notas de por qué es así:

- `'unsafe-inline'` en `script-src` es necesario porque las SPAs usan scripts
  inline (p. ej. `next-themes` para evitar el parpadeo de tema) y la app de
  cliente carga Google OAuth.
- `form-action` **no** se limita a `'self'`: los checkout de Wompi/Epayco hacen
  POST a otro origen y se romperían.
- La política sigue aportando: bloquea `<object>`/`<embed>`, `<base>` inyectado
  y el framing.
- Se puede endurecer o desactivar con `CSP_POLICY` (`off` ⇒ sin cabecera).

## 4. Autenticación y autorización

- **Usuarios/panel**: JWT (access + refresh con rotación en BD) y guardas por
  rol. Solo en producción ya no se expone Swagger (`NODE_ENV=production`).
- **Clientes**: JWT propio con refresh; los tokens viajan en cookie httpOnly
  cuando el navegador lo permite.
- **Paneles de administración** (`HOST_ADMIN`, `HOST_PICKING_ADMIN`,
  `HOST_DELIVERY_ADMIN`): **Basic Auth por defecto** (`PROTECT_ADMIN=true`) con
  credenciales `ADMIN_USER` / `ADMIN_PASSWORD(_HASH)`.
  - **Fail-closed**: si `PROTECT_ADMIN=true` y no hay contraseña, el contenedor
    **no arranca**.
  - La contraseña se hashea con bcrypt (`caddy hash-password`); se prefiere
    `ADMIN_PASSWORD_HASH` para no dejar la clave en claro en el `.env`.
- **Bot** (`/bot/*`): **no se publica en Caddy**. El backend NestJS proxya
  `/bot/*` hacia el loopback del bot (`127.0.0.1:8001`) dentro del contenedor,
  así que el bot solo es alcanzable a través del backend. Su rate limit y CORS
  interno siguen aplicando; las cabeceras CORS finales las pone el backend.
- **Validación de entrada**: `ValidationPipe` con `whitelist` y
  `forbidNonWhitelisted` (rechaza campos no declarados en los DTO).

## 5. Control de abuso (rate limiting)

Implementación **propia, en memoria**, sin dependencias ni servicios externos
(adecuada para una sola instancia).

| Capa | Rutas | Límite | Variables |
|---|---|---|---|
| Backend | `/auth/*` y `/customer-auth/*` que contengan `login`, `register`, `refresh`, `reset`, `forgot` o `social` | **15 peticiones / 60 s por IP** | `RATE_LIMIT_ENABLED` |
| Bot | `/chat*` y `/cart*` | **20 peticiones / 60 s por IP** | `CHAT_RATE_LIMIT`, `CHAT_RATE_WINDOW` |

- Respuesta al exceder: **HTTP 429** con `Retry-After`.
- Detrás de Caddy es imprescindible `TRUST_PROXY=loopback,uniquelocal` (ya
  definido en el compose) para que la IP sea la del cliente vía
  `X-Forwarded-For`; **sin eso todas las peticiones comparten un solo cubo** y
  el límite se agotaría globalmente. Con el edge delante (modo edge) el Caddy
  interno confía en esa red (`trusted_proxies static private_ranges`) para no
  perder la IP real.
- Los cubos viven en memoria: se reinician con el contenedor y **no** se
  comparten entre réplicas (aquí solo hay una).
- No sustituye a un WAF: es defensa en profundidad del lado de la aplicación.

## 6. Límites de tamaño y CORS

- **Cuerpo de petición**: `request_body { max_size 50MB }` en el borde
  (`MAX_REQUEST_BODY`; `0` lo desactiva). El backend además limita a 50 MB.
- **CORS**: lista blanca `CORS_ORIGIN`, derivada automáticamente de los
  `HOST_*` (`https://<host>` por cada interfaz) si no se define. **Nunca `*`**,
  y con credenciales habilitadas.

## 7. Endurecimiento del contenedor

- Usuario **sin privilegios** (`merc`, uid 10001); el proceso nunca es root.
- `cap_drop: ALL` y `security_opt: no-new-privileges:true`
  (no se necesita `NET_BIND_SERVICE` al escuchar en puertos altos).
- **Solo 80/443** publicados.
- **Rotación de logs** de Docker (`max-size 10m`, `max-file 5`) para evitar
  llenar el disco (el backend registra cada petición).
- **API de administración de Caddy desactivada** (`admin off`).
- `restart: unless-stopped` + `healthcheck` contra `http://127.0.0.1:3100/api-status`.
- Volúmenes: `mercaldas_caddy_data`, `mercaldas_caddy_config` y
  `mercaldas_media` (medios locales del backend, para que sobrevivan a recrear
  el contenedor).

## 8. Secretos

- **Nunca entran en la imagen**: `.dockerignore` excluye `.env` y `.env.*`.
- **Nunca se versionan**: `.gitignore` los excluye (excepto `.env.example`).
- Viven en `docker/.env` (secreto) o como variables del orquestador.
- Requeridos: `DATABASE_URL`, `JWT_SECRET`, `DEEPSEEK_API_KEY`; según el caso,
  claves de Wompi/Epayco y `RESEND_API_KEY`.
- Imágenes: con `MEDIA_STORAGE=local` se guardan en el volumen
  `mercaldas_media` y **no** se necesitan `CLOUDINARY_*`. Si se usa
  `MEDIA_STORAGE=cloudinary`, entonces `CLOUDINARY_*` son obligatorias (el
  backend aborta sin ellas).
- `ADMIN_PASSWORD_HASH` es preferible a `ADMIN_PASSWORD` (esta última se hashea
  al arrancar, pero viaja en claro en el `.env`).
- Recomendaciones: permisos `600` sobre `docker/.env`, rotación periódica y
  rotar de inmediato cualquier secreto que haya pasado por un chat, un log o un
  repositorio.

## 9. Base de datos

- **Nunca publicada**: en producción vive en `mercaldas_internal`
  (`internal: true`).
- En el compose de desarrollo (`db/docker`) el puerto está bindeado a
  **`127.0.0.1`** (no a `0.0.0.0`), igual que OSRM en `delivery-routing`.
- Credenciales de desarrollo (`postgres/postgres`) **no** deben usarse en
  producción: define un usuario/clave propios en `DATABASE_URL`.
- Recomendado: rol de mínimos privilegios (sin DDL) para el arranque; el
  `sync-schema.js` que corre al iniciar solo avisa si falla.
- **Backups** periódicos y **probados** (un backup no probado no es un backup).

## 10. Verificación (checklist operativo)

```bash
# 1. Solo el EDGE publica 80/443; la app solo en loopback
docker compose -f docker/docker-compose.yml ps
docker port mercaldas_app        # espera 127.0.0.1:30180->8080
docker port edge_caddy           # espera 0.0.0.0:80->80 y 0.0.0.0:443->443

# 2. Desde fuera, los puertos internos NO responden
curl -sS -m 3 http://<IP>:3100/ || echo "OK: 3100 cerrado"
curl -sS -m 3 http://<IP>:8001/ || echo "OK: 8001 cerrado"
curl -sS -m 3 http://<IP>:5432/ || echo "OK: 5432 cerrado"

# 3. Cabeceras y TLS
curl -I https://<HOST_WEB>/
curl -I https://<HOST_WEB>/api-status
curl -I https://<HOST_WEB>/discovery

# 4. Paneles protegidos y bot solo por el backend
curl -I https://<HOST_ADMIN>/          # espera 401
curl -I https://<HOST_ADMIN>/ -u admin:clave   # espera 200
curl -I https://<HOST_WEB>/bot/health  # espera 200 (vía backend)
# El alias HOST_API solo debe servir webhooks
curl -I https://<HOST_API>/auth/login  # espera 404

# 5. Rate limit activo (ráfaga de logins → 429)
for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code} " \
  -X POST https://<HOST_WEB>/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"x","password":"y"}'; done; echo

# 6. Config del proxy válida (antes de arrancar)
HOST_WEB=web.ejemplo.com HOST_ADMIN=admin.ejemplo.com PROTECT_ADMIN=true \
  ADMIN_PASSWORD=secreto CADDYFILE_OUT=/tmp/Caddyfile \
  node docker/gen-caddyfile.mjs
docker run --rm -v /tmp/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2.11.7 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Se espera: en (4) `401` sin credenciales y `200` con ellas; en (5) que aparezca
algún `429`.

## 11. Riesgos residuales (NO cubierto por este despliegue)

| # | Riesgo | Mitigación recomendada |
|---|---|---|
| 1 | ~~Sin WAF ni anti-DDoS~~ **mitigado en producción** | Cloudflare (DNS + proxy) delante y 80/443 restringidos a sus rangos en `DOCKER-USER` + `ufw` (ver `docs/DESPLIEGUE-DOCKER.md` §4). La IP de origen ya no responde en 80/443 |
| 2 | **Sin 2FA** en las cuentas de administración | Añadirlo en la app o restringir los paneles por VPN / Cloudflare Access |
| 3 | **Servidor anterior (Windows Server)**: RDP (3389) expuesto | Ya no es el servidor de producción; si se reutiliza, restringir 3389 por IP/VPN y parchearlo |
| 11 | **Puertos heredados del host Windows**: 5002 (Apache/XAMPP), 6262 (Advantage DB), 8501, 19955 | No existen en el servidor nuevo; en el viejo, cerrarlos si no se usan externamente |
| 12 | **Gestión del servidor por Tailscale** | El servidor nuevo solo admite SSH con llave (22); Tailscale es la vía de administración. Si cae, queda SSH por IP pública con llave |
| 4 | **Token de respaldo en `localStorage`** (client) cuando no hay cookie httpOnly | Un XSS podría leerlo; por eso la CSP importa |
| 5 | **Rate limit en memoria**: no sobrevive reinicios ni se comparte entre réplicas | Un WAF o un almacén compartido si algún día se escala |
| 6 | **`/api-status` es público** | Es necesario para el cliente (espera al backend); expone solo estado |
| 7 | **Sistema de ficheros escribible** dentro del contenedor | `read_only: true` + `tmpfs` requiere antes mover `MEDIA_STATIC_DIR` a un volumen |
| 8 | **Sin alertas ni monitorización** | Alertas de caída y de picos de 401/429/5xx; fail2ban en el host |
| 9 | **Secretos sin rotación automática** | Rotación programada y tras cualquier incidente |
| 10 | **Apps móviles** (Expo) fuera del contenedor | Compilar el APK apuntando a `HOST_WEB` por HTTPS; no repartir builds de depuración |

## 12. Variables de seguridad (referencia rápida)

| Variable | Def. | Efecto |
|---|---|---|
| `TLS` | `true` | `false` exige `ALLOW_INSECURE=true` y desactiva HTTPS |
| `ALLOW_INSECURE` | `false` | Acepta explícitamente servir en HTTP (no usar en producción) |
| `ACME_EMAIL` | — | Correo para Let's Encrypt |
| `PROTECT_ADMIN` | `true` | Basic Auth en los paneles; **fail-closed** sin contraseña |
| `ADMIN_USER` | `admin` | Usuario del Basic Auth |
| `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` | — | Credencial (se prefiere el hash bcrypt) |
| `CSP_POLICY` | (política por defecto) | CSP a medida; `off` la desactiva |
| `MAX_REQUEST_BODY` | `50MB` | Tamaño máximo de cuerpo en el borde (`0` = sin límite) |
| `RATE_LIMIT_ENABLED` | `false` | Activa el límite de `/auth/*` en el backend (el compose lo pone `true`) |
| `TRUST_PROXY` | — | Debe ser `loopback,uniquelocal` detrás del edge/Caddy para el rate limit por IP |
| `CHAT_RATE_LIMIT` / `CHAT_RATE_WINDOW` | `20` / `60` | Límite del bot por IP y ventana |
| `PUBLIC_HTTP_PORT` / `PUBLIC_HTTPS_PORT` | `127.0.0.1:30180` / `127.0.0.1:30181` | Puertos publicados en el host (loopback en modo edge) |
| `PUBLIC_SCHEME` | `https` | Esquema público real (CORS derivado detrás del edge) |
| `HOST_*`, `VITE_API_URL` | — | Dominios publicados y URL pública del API |

## 13. Respuesta ante incidentes (mínimo)

1. **Contener**: `docker compose -f docker/docker-compose.yml down`.
2. **Rotar** todos los secretos de `docker/.env` (JWT, BD, Cloudinary, DeepSeek,
   pagos, Resend) y las credenciales de admin.
3. **Revisar** `docker compose logs app` y los logs del host (accesos, 401/429).
4. **Restaurar** desde el último backup verificado si hubo manipulación de datos.
5. **Parchear** la causa (imagen, dependencias, configuración) y volver a
   desplegar; dejar constancia en este documento si cambia el modelo.
