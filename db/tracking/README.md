# Base de datos de analítica (`mercaldas_tracking`)

Base **separada** de la operativa (`ecommerce`). Si el tracking se cae o se
satura, la tienda no se ve afectada.

- Esquema: [`schema.sql`](./schema.sql)
- Roles: [`roles.sql`](./roles.sql)

## Requisitos

- PostgreSQL 14+.
- Extensión `pgcrypto` (la crea `schema.sql`).

## Instalación

```bash
createdb mercaldas_tracking
psql -d mercaldas_tracking -v ON_ERROR_STOP=1 -f db/tracking/schema.sql
psql -d mercaldas_tracking -v ON_ERROR_STOP=1 -f db/tracking/roles.sql
```

Cadena de conexión para los servicios Rust (ejemplo local):

```env
TRACKING_DATABASE_URL=postgresql://tracking_worker:****@localhost:5432/mercaldas_tracking
```

> Usar el rol `tracking_worker` para el worker, `tracking_ingest` para la
> ingesta y `tracking_readonly` para dashboards. No usar el superusuario.

## Modelo de datos

| Tabla | Contenido | Retención |
| --- | --- | --- |
| `tracking_sessions` | Sesión anónima (`anonymous_id`), `customer_id` opcional, consentimiento vigente, `ip_hash` | Se limpia al purgar eventos |
| `tracking_consents` | Evidencia append-only de cada autorización/revocación | 5 años |
| `tracking_events` | Eventos crudos, append-only, `event_id` único | 90 días |
| `tracking_event_daily` | Rollup diario por evento/ruta/etiqueta | 24 meses |
| `tracking_deletion_requests` | Solicitudes de derechos del titular | Según proceso legal |
| `tracking_ingest_rejections` | Payloads rechazados (sin PII) para depurar | 30 días |
| `tracking_api_keys` | Hashes de API keys de ingesta | Mientras estén activas |

### Campos prohibidos

En `properties` y `context` **nunca** debe entrar:

- Valores de formularios (nombre, teléfono, correo, dirección, documento).
- Contraseñas, tokens, cookies o cabeceras de autenticación.
- IPs en claro (solo `ip_hash`).
- Texto libre de búsquedas (salvo decisión explícita y documentada).

La ingesta y el worker deben validar contra una lista blanca y rechazar el resto.

## Mantenimiento

### Purga de eventos crudos (90 días)

```sql
select purge_tracking_events(90);
```

Programar con `pg_cron`:

```sql
select cron.schedule('tracking-purge', '15 3 * * *', $$select purge_tracking_events(90)$$);
```

O con cron del sistema:

```cron
15 3 * * * psql "$TRACKING_DATABASE_URL" -c "select purge_tracking_events(90);"
```

### Rollup diario

```sql
select refresh_tracking_event_daily(current_date - 1);
```

Programar tras la medianoche:

```sql
select cron.schedule('tracking-rollup', '10 0 * * *',
  $$select refresh_tracking_event_daily(current_date - 1)$$);
```

### Derecho de supresión

```sql
-- Por identificador anónimo
select delete_tracking_subject('00000000-0000-0000-0000-000000000000', null);

-- Por cliente autenticado
select delete_tracking_subject(null, 12345);
```

Registrar la solicitud en `tracking_deletion_requests` y marcarla como
`completed` con `processed_at`.

## Consultas de ejemplo

Eventos por día y tipo (últimos 30 días):

```sql
select day, event_name, sum(events) as events, sum(sessions) as sessions
  from tracking_event_daily
 where day >= current_date - interval '30 days'
 group by day, event_name
 order by day desc, events desc;
```

Embudo básico:

```sql
select event_name, count(*) as total
  from tracking_events
 where occurred_at >= now() - interval '7 days'
   and event_name in (
     'page.view', 'ecom.product.view', 'ecom.cart.add',
     'ecom.checkout.start', 'ecom.order.placed'
   )
 group by event_name;
```

Interacciones más usadas por pantalla:

```sql
select page_path, element_label, count(*) as clicks
  from tracking_events
 where kind = 'click'
   and occurred_at >= now() - interval '7 days'
 group by page_path, element_label
 order by clicks desc
 limit 50;
```

## Backup

Incluir `mercaldas_tracking` en la política de backups cifrados. Al ser datos
pseudonimizados y con retención corta, puede tener una frecuencia menor que la
base operativa, pero debe poder restaurarse.

## Notas

- `schema.sql` es idempotente (`if not exists` / bloques `do`), salvo los `create
  type`, que se crean solo si no existen.
- Las tablas son append-only por diseño. Si se necesita corregir un evento, se
  inserta uno nuevo con `event_id` distinto; no se actualiza el histórico.
- No particionar todavía: con el volumen actual, los índices por `occurred_at`
  bastan. Si el crudo supera decenas de millones de filas, migrar a particiones
  mensuales por `occurred_at`.
