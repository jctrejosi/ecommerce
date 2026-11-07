# Broker de tracking (Redis Streams)

Cola entre la **ingesta** (Rust) y el **worker** (Rust). Se usa **Redis Streams**
porque da consumer groups, acks y recuperación de mensajes pendientes sin operar
un cluster tipo Kafka, y el volumen de una tienda no justifica más infraestructura.

## Arranque

```bash
cd broker-tracking
docker compose up -d
docker compose logs -f redis
```

Escucha en `localhost:6380` (mapeado al 6379 del contenedor) para no chocar con
otro Redis del equipo. El puerto se publica solo en `127.0.0.1` y dentro del
contenedor se desactiva `protected-mode` (la conexión llega desde la IP del
gateway de Docker). En producción: `requirepass` y red privada.

```env
TRACKING_REDIS_URL=redis://localhost:6380/0
# Producción: redis://:PASSWORD@host:6380/0  (y red privada / TLS)
```

## Contrato de la cola

| Elemento | Valor |
| --- | --- |
| Stream | `tracking:events` |
| Consumer group | `tracking-workers` |
| Dead letter | `tracking:dead` |
| Campo del mensaje | `event` (JSON UTF-8 con el evento validado) + `received_at` |

La ingesta publica **un mensaje por evento**:

```text
XADD tracking:events MAXLEN ~ 1000000 * event '{"event_id":"…","event_name":"ecom.cart.add",…}' received_at '2026-10-06T15:42:11Z'
```

- `MAXLEN ~ 1000000`: recorta de forma aproximada al superar ~1M de mensajes. Si
  se necesita más retención, subir el límite o desactivar el recorte.
- El worker crea el grupo al arrancar (idempotente):

```text
XGROUP CREATE tracking:events tracking-workers $ MKSTREAM
```

## Consumo (worker)

1. `XREADGROUP GROUP tracking-workers worker-1 COUNT 100 BLOCK 5000 STREAMS tracking:events >`
2. Procesa el lote y escribe en PostgreSQL (upsert de sesión + `INSERT … ON
   CONFLICT (event_id) DO NOTHING`).
3. `XACK tracking:events tracking-workers <id>` **solo después** del commit en BD.
4. Si el evento es inválido de forma definitiva → publicar en `tracking:dead`,
   registrar en `tracking_ingest_rejections` y `XACK`.
5. Si falla la BD → no hacer `XACK`; el mensaje queda pendiente y se reintenta.

Recuperación de mensajes de workers caídos (cada minuto, por ejemplo):

```text
XAUTOCLAIM tracking:events tracking-workers worker-1 60000 0-0 COUNT 100
```

## Retención e higiene

- `MAXLEN ~ 1_000_000` en `XADD` (aproximado, eficiente).
- Los mensajes confirmados se pueden recortar con `XTRIM`:
  ```text
  XTRIM tracking:events MAXLEN ~ 1000000
  ```
- Vigilar que el largo del stream no crezca sin control:
  ```text
  XLEN tracking:events
  XINFO GROUPS tracking:events
  XPENDING tracking:events tracking-workers
  ```
- `pending` alto y estable = worker caído o lento.

## Persistencia y caídas

`redis.conf` usa AOF `everysec` y `maxmemory-policy noeviction`:

- AOF evita perder la cola en un reinicio.
- `noeviction` evita que Redis expulse mensajes para liberar memoria; si se llena,
  la ingesta recibe error y se nota (mejor que perder eventos en silencio).

## Seguridad

- `requirepass` en producción (ver `redis.conf`).
- No exponer el puerto a Internet; solo red privada / VPN.
- Deshabilitar `FLUSHALL`/`FLUSHDB` en producción.
- El worker y la ingesta usan credenciales distintas de las de administración si
  se configuran ACLs.

## Alternativa

Si más adelante se necesita retención larga con replay o múltiples consumidores
independientes con histórico, migrar a **NATS JetStream**. El contrato
(`tracking:events` + consumer group) se mantiene conceptualmente igual.
