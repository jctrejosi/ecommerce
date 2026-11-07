# backend-tracking

Ingesta y worker de la **analítica propia** de Mercaldas (Rust). No usa cookies
de terceros ni servicios externos.

El diseño, el modelo de eventos y las obligaciones de protección de datos están
en [`docs/tracking/README.md`](../docs/tracking/README.md). El esquema de la base
está en [`db/tracking/schema.sql`](../db/tracking/schema.sql) y el broker en
[`broker-tracking/`](../broker-tracking/).

## Arquitectura

```text
cliente web/APK
      │  POST /v1/events  (X-Api-Key)
      ▼
ingest (axum :8090) ──valida──▶ Redis Streams `tracking:events`
      │                                  │
      └─ POST /v1/consents ──▶ PG        │ XREADGROUP
                                         ▼
                                      worker ──▶ PostgreSQL `mercaldas_tracking`
```

- **ingest**: valida esquema, consentimiento, tamaño, rate limit y publica.
- **worker**: consume, revalida, escribe sesión + evento en una transacción y
  solo entonces hace `XACK`. Los inválidos van a `tracking_ingest_rejections` y
  a `tracking:dead`.

## Requisitos

- Rust 1.80+ (`cargo`).
- PostgreSQL con la base `mercaldas_tracking` y el esquema aplicado.
- Redis con el `broker-tracking/docker-compose.yml` levantado (puerto 6380).

## Puesta en marcha (local)

```bash
# 1. Base de datos (una sola vez)
createdb -h localhost -U postgres mercaldas_tracking
psql -h localhost -U postgres -d mercaldas_tracking -v ON_ERROR_STOP=1 \
  -f ../db/tracking/schema.sql

# 2. Broker
cd ../broker-tracking && docker compose up -d && cd ../backend-tracking

# 3. Configuración
cp .env.example .env          # ajustar sales y credenciales

# 4. Compilar
cargo build --release

# 5. Registrar una API key (imprime la clave una sola vez)
./scripts/new-api-key.sh web-local

# 6. Arrancar worker e ingesta en terminales separadas
cargo run --release --bin worker
cargo run --release --bin ingest
```

> La API key se guarda como `sha256(clave + ":" + TRACKING_API_KEY_SALT)`.
> Si se prefiere calcular el hash a mano:
>
> ```bash
> echo -n "mi-api-key:<sal>" | sha256sum
> ```

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness. `{status, service, version, enabled}`. |
| `GET` | `/readyz` | Comprueba PostgreSQL y Redis (200/503). |
| `POST` | `/v1/events` | Lote de eventos (máx. 100) o evento único. |
| `POST` | `/v1/consents` | Evidencia de consentimiento. |

Todas las rutas `POST` requieren `X-Api-Key`. Respuestas de error:

| Código | `error` | Causa |
| --- | --- | --- |
| 400 | `invalid_payload` | JSON inválido o campos desconocidos. |
| 400 | `empty_batch` / `batch_too_large` | Tamaño del lote. |
| 401 | `missing_api_key` / `invalid_api_key` | API key ausente o inactiva. |
| 429 | `rate_limited` | Límite por IP/API key. |
| 503 | `tracking_disabled` | `TRACKING_ENABLED=false`. |
| 503 | `broker_unavailable` | No se pudo publicar; el cliente debe reintentar. |

`POST /v1/events` responde `202 Accepted`:

```json
{
  "accepted": 2,
  "rejected": [
    { "event_id": "…", "reason": "forbidden_property_key" }
  ]
}
```

Los rechazos por evento **no** impiden que se acepten los demás. Si el cliente
reenvía, `event_id` garantiza idempotencia.

### Evento

```json
{
  "event_id": "6f1c2a9e-2b1f-4d0a-9a3e-2f6c1d7b8e10",
  "anonymous_id": "0b9f1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d",
  "customer_id": 42,
  "kind": "click",
  "event_name": "ecom.cart.add",
  "occurred_at": "2026-10-06T15:42:11.312-05:00",
  "page": { "path": "/catalog", "url": "https://tienda/catalog" },
  "element": { "tag": "button", "label": "Agregar", "id": "product-add-10", "component": "ProductCard" },
  "properties": { "product_id": 10, "category": "GRANOS", "price": 3200, "quantity": 1 },
  "context": { "viewport": "390x844", "device": "mobile", "app": "web" },
  "consent": { "analytics": true, "version": "2026-10" }
}
```

Reglas de validación (rechazo con `reason`):

- `event_name`: `dominio.objeto.accion`, 2–4 segmentos, `snake_case`, ≤ 120.
- `occurred_at`: no más de 5 min en el futuro ni 30 días en el pasado.
- `consent.analytics` debe ser `true` (la analítica está apagada por defecto).
- `properties` ≤ 8 KB y `context` ≤ 4 KB; deben ser objetos JSON.
- Claves prohibidas (PII/secretos) en `properties`/`context`: email, teléfono,
  nombre, dirección, documento, contraseña, tokens, IP, texto libre de búsqueda…
  Se detectan también en `camelCase` y compuestas (`customer_email`).
  `product_name` sí está permitido.
- `schema_version` debe ser `1`.

### Consentimiento

```json
{
  "anonymous_id": "0b9f1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d",
  "customer_id": 42,
  "purpose": "analytics",
  "granted": true,
  "policy_version": "2026-10",
  "source": "banner",
  "context": { "locale": "es-CO", "timezone": "America/Bogota" }
}
```

## Variables de entorno

Ver [`.env.example`](./.env.example). Las claves:

| Variable | Default | Descripción |
| --- | --- | --- |
| `TRACKING_DATABASE_URL` | — | Obligatoria. |
| `TRACKING_REDIS_URL` | `redis://localhost:6380/0` | Broker. |
| `TRACKING_BIND_ADDR` | `0.0.0.0:8090` | Ingesta. |
| `TRACKING_API_KEY_SALT` | `dev-…` | Falla en producción si no se cambia. |
| `TRACKING_IP_HASH_SALT` | = API key salt | Sal del hash de IP. |
| `TRACKING_ENABLED` | `true` | Kill switch. |
| `TRACKING_BATCH_SIZE` | `100` | Máximo por petición. |
| `TRACKING_CONSUMER_NAME` | `worker-<pid>` | Identidad en el grupo. |

## Docker

```bash
docker build -t mercaldas/backend-tracking .
docker run --rm -p 8090:8090 --env-file .env mercaldas/backend-tracking ingest
docker run --rm --env-file .env mercaldas/backend-tracking worker
```

## Operación

- **Pendientes**: el worker reclama mensajes con `XAUTOCLAIM` cada
  `TRACKING_CLAIM_INTERVAL_MS` (por defecto 60 s, con antigüedad mínima 60 s).
  Si la BD falla, el lote no se confirma y se reintenta.
- **Retención**: programar `purge_tracking_events(90)` y
  `refresh_tracking_event_daily(day)` (ver `db/tracking/README.md`).
- **Supresión**: `delete_tracking_subject(anonymous_id, customer_id)`.
- **Rotación de API key**: insertar una nueva fila y desactivar la anterior
  (`update tracking_api_keys set is_active = false where id = …`).

## Estado

Implementado: ingesta, worker, validación, rate limit, idempotencia, dead letter,
reclamo de pendientes, pruebas unitarias.

Pendiente (fases siguientes, ya documentadas en `docs/tracking/README.md`): SDK
del cliente (anonymous_id, consentimiento, cola), banner de cookies y páginas
legales.
