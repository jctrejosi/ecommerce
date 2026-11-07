# Servicios adicionales en el VPS (Astaroth, Paimon, WhatsApp Bot)

Además del ecommerce, el CRM y la contabilidad, el VPS Windows
(`170.254.229.68`) sirve tres proyectos más. Todos se publican **solo** a
través del borde TLS `edge_caddy` (puertos 80/443); ningún otro puerto se
expone a internet.

| Proyecto | Repo en el VPS | Dominio | Autenticación |
|---|---|---|---|
| Astaroth (APIs de ML) | `Documents/astaroth` | `https://astaroth.jcti.xyz` | Clave de API (`API_KEYS`) |
| Paimon (audio/imagen/proceso) | `Documents/paimon` | `https://paimon.jcti.xyz` | Clave de API (`API_KEYS`) |
| WhatsApp Bot Platform | `Documents/whatsapp-bot-platform` | `https://bot-platform.jcti.xyz` | Login propio (JWT) |

## DNS

Registros **A → `170.254.229.68`**, TTL 600, en GoDaddy (`jcti.xyz`):

| Nombre |
|---|
| `astaroth` |
| `paimon` |
| `bot-platform` |

Verificación:

```bash
dig @ns03.domaincontrol.com +short astaroth.jcti.xyz
dig @ns03.domaincontrol.com +short paimon.jcti.xyz
dig @ns03.domaincontrol.com +short bot-platform.jcti.xyz
```

Los tres deben devolver la IP. Sin DNS no hay certificado Let's Encrypt.

## Rutas publicadas por el edge

`docker/edge/Caddyfile` contiene un bloque por dominio:

- **`astaroth.jcti.xyz`** → `handle_path` a `astaroth:8010..8015`:
  `/clustering/*`, `/xgboost/*`, `/uplift/*`, `/transformer/*`, `/causal/*`,
  `/highs/*`.
- **`paimon.jcti.xyz`** → `/audio/*` → `paimon-audio-processing:8000`,
  `/image/*` → `paimon-image-api:8000`, `/processing/*` →
  `paimon-image-processing:8000`.
- **`bot-platform.jcti.xyz`** → `whatsapp_bot_web:80` (nginx sirve la SPA y
  proxya `/api` y `/webhook` hacia `whatsapp_bot_api:3100`).

Los `handle_path` **eliminan el prefijo**, por eso
`https://paimon.jcti.xyz/image/health` llega como `/health` a la API de imagen.

## Contenedores y puertos (todos en `127.0.0.1` del host)

| Proyecto | Contenedores | Puertos host |
|---|---|---|
| Astaroth | `astaroth` | `8010-8015` |
| Paimon audio | `paimon-audio-processing` | `8100` |
| Paimon imagen | `paimon-image-api`, `paimon-comfyui`, `paimon-image-generator-worker-1`, `paimon-redis` | `8101`, `8188`, `9101` |
| Paimon procesamiento | `paimon-image-processing` | `8102` |
| WhatsApp | `whatsapp_bot_web`, `whatsapp_bot_api`, `whatsapp_bot_worker`, `whatsapp_bot_ingestion`, `whatsapp_bot_db` | `8300`, `8301`, `5441` |

El edge los alcanza por nombre dentro de la red `shared_edge`; los puertos del
host existen solo para depuración local.

## Operación

Todo se ejecuta con Docker dentro de WSL Ubuntu:

```bash
ssh dsi-vps "wsl -d Ubuntu -u root -- docker ps"
```

Cada proyecto conserva su `docker-compose.yml` y un `docker-compose.edge.yml`
que añade la red externa `shared_edge`.

### Astaroth

```bash
docker compose --project-directory /mnt/c/Users/Desarrolo4/Documents/astaroth \
  -f docker-compose.yml -f docker-compose.edge.yml up -d
```

### Paimon (tres stacks independientes)

```bash
for d in audio_processing image_generator image_processing; do
  docker compose --project-directory /mnt/c/Users/Desarrolo4/Documents/paimon/$d \
    -f docker-compose.yml -f docker-compose.edge.yml up -d --pull never
done
```

### WhatsApp Bot

```bash
docker compose --project-directory /mnt/c/Users/Desarrolo4/Documents/whatsapp-bot-platform \
  -f docker-compose.yml -f docker-compose.edge.yml up -d --pull never
```

### Recargar el edge tras cambiar el `Caddyfile`

```bash
docker exec edge_caddy caddy validate --config /etc/caddy/Caddyfile
docker exec edge_caddy caddy reload   --config /etc/caddy/Caddyfile
```

## Verificación

Todos los servicios responden `401` sin clave (salvo `/health`, que es abierto) y
`200` con una clave válida de `API_KEYS`.

```bash
# Healthchecks: abiertos.
curl -sS -o /dev/null -w "%{http_code}\n" https://astaroth.jcti.xyz/clustering/health
curl -sS -o /dev/null -w "%{http_code}\n" https://paimon.jcti.xyz/audio/health

# Protegidos: 401 sin clave, 200 con clave.
curl -sS -o /dev/null -w "%{http_code}\n" https://astaroth.jcti.xyz/clustering/models
curl -sS -H "X-API-Key: <ASTAROTH_API_KEY>" \
  -o /dev/null -w "%{http_code}\n" https://astaroth.jcti.xyz/clustering/models

curl -sS -o /dev/null -w "%{http_code}\n" https://paimon.jcti.xyz/image/docs
curl -sS -H "Authorization: Bearer <PAIMON_API_KEY>" \
  -o /dev/null -w "%{http_code}\n" https://paimon.jcti.xyz/image/docs

# API del bot (debe responder JSON, no 502).
curl -sS -X POST -H "Content-Type: application/json" \
  -d '{"username":"x","password":"y"}' \
  https://bot-platform.jcti.xyz/api/auth/login
```

## Claves de API

Las APIs de Astaroth y Paimon son públicas (no hay Basic Auth en el edge) y cada
servicio valida la clave él mismo, leyéndola de su `.env`.

| Proyecto | Archivo | Variable |
|---|---|---|
| Astaroth | `astaroth/.env` | `API_KEYS` (una clave para los 6 servicios) |
| Paimon | `paimon/.env` | `API_KEYS` (una clave para los 3 servicios) |

```dotenv
API_KEYS=clave1,clave2
API_AUTH_REQUIRED=1
API_PUBLIC_DOCS=0
```

- El cliente envía `X-API-Key: <clave>` o `Authorization: Bearer <clave>`.
- Varias claves separadas por comas: se revoca una sin tocar a los demás clientes.
- `/health` queda abierto para los healthchecks de Docker y del edge.
- `API_PUBLIC_DOCS=1` abre `/docs`, `/redoc` y `/openapi.json` (solo el esquema).
- `image_generator` acepta además `?token=` porque SSE no permite cabeceras.
- Si `API_AUTH_REQUIRED=1` y `API_KEYS` está vacío → `503` (fail-closed).

Otros secretos (no se versionan):

| Archivo | Contenido |
|---|---|
| `astaroth/.env` | `ADMIN_KEY` (endpoints `/admin/*`), `DATABASE_URL` |
| `paimon/*/.env` | tokens heredados, API keys de proveedores |
| `whatsapp-bot-platform/.env` | `JWT_SECRET`, `DB_PASSWORD`, tokens de Meta, `OPENAI_API_KEY` |

## Seguridad aplicada

- Un único punto de entrada público: **TCP 80/443** (edge).
- Todas las APIs y paneles de estos tres proyectos están en `127.0.0.1` o en
  redes internas de Docker.
- Astaroth y Paimon se autentican con **clave de API** validada por el propio
  servicio (`X-API-Key` o `Bearer`); el edge no añade Basic Auth.
- El bot queda detrás de su login propio (JWT).
- HSTS y cabeceras del edge (`import edge_headers`).
- La BD del bot (`whatsapp_bot_db`) solo en `127.0.0.1:5441`.

## Persistencia

- Todos los servicios tienen `restart: unless-stopped`.
- La tarea programada `MercaldasDockerEngine` (BootTrigger + repetición cada
  minuto) mantiene viva la distro WSL y con ella `systemd`/`docker`
  (`systemctl is-enabled docker` → `enabled`).
- Ver `VPS-WINDOWS.md` para el detalle del portproxy 80/443.

## Limitaciones conocidas

- **ComfyUI sin checkpoint**: `paimon/image_generator/ComfyUI/models/checkpoints/`
  está vacío. La API responde, pero la generación real falla hasta copiar
  `v1-5-pruned-emaonly.safetensors` o apuntar `COMFYUI_CHECKPOINT` a otro modelo.
- **Astaroth con `DATABASE_URL` vacío**: `/fit-from-db` y `/assign-from-db`
  devuelven 503; los endpoints que usan modelos locales funcionan.
- **Paimon sin modelos pesados**: los de audio (~1,3 GB) y `rembg` (~2,4 GB) no
  se copiaron; se descargan al primer uso o hay que montarlos.

## Incidencias resueltas

### `502` en `/api` y `/webhook` del panel del bot

El `nginx` del panel resolvía `api:3100`. Como el contenedor `whatsapp_bot_web`
está en `shared_edge` y el servicio `api` de **Paimon** también está en esa red
con el alias `api`, Docker DNS devolvía la IP de Paimon (puerto 8000) y la
conexión se rechazaba.

Solución: en `apps/web/nginx.conf` el upstream es ahora el nombre único
`whatsapp_bot_api:3100`. Requiere reconstruir la imagen `web`.

**Regla:** al añadir servicios a `shared_edge`, no uses nombres genéricos
(`api`, `web`, `db`) como alias de red; usa el `container_name`.
