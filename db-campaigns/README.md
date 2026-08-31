# db-campaigns/ — PostgreSQL de analytics (campañas y segmentación)

Réplica de solo lectura del legado **Advantage** (los `.ADT` pasados a Postgres)
que alimenta la **segmentación** de campañas. **No tiene nada que ver con la BD
transaccional del ecommerce** (esa vive en `db/docker/`, puerto 5432).

## Qué contiene

| Schema | Contenido |
|---|---|
| `pos` | `venta_lineas` (10M filas, particionado por mes), `clientes` (184K con contacto y consentimientos), `facturas`, `bodegas`, `sync_control` |
| `analytics` | `vw_rfm_clientes` (vista RFM: 82K clientes), `cliente_segmento` (81.955) |

## Levantarla

La levanta el lanzador junto con todo lo demás:

```bash
node dev.js            # levanta PostgreSQL (5432) + analytics (5436) + servicios
node dev.js --stop     # detiene los servicios (las BDs docker siguen)
```

O solo la BD:

```bash
cd db-campaigns && docker compose up -d --wait
```

Conexión: `postgresql://postgres:postgres@localhost:5436/analytics`
(es la `DATABASE_URL` que usa el `clustering-api` de Astaroth).

## Restaurar desde el dump

Si el volumen está vacío (PC nuevo), restaura la copia:

```bash
# el dump (354 MB) vive en db/backups/analytics/analytics_2026-08-31.backup
docker exec analytics_postgres psql -U postgres -d analytics -c "SELECT 1" # espera a que esté listo
docker cp db/backups/analytics/analytics_2026-08-31.backup analytics_postgres:/tmp/db.backup
docker exec analytics_postgres pg_restore -U postgres -d analytics -j 4 /tmp/db.backup
docker exec analytics_postgres psql -U postgres -d analytics \
  -c "SELECT count(*) FROM analytics.vw_rfm_clientes;"   # → 81.997
```

## Notas

- **Datos**: viven en el volumen docker `analytics_postgres_data` (2.9 GB), no en
  este folder. Se preservan al recrear el contenedor.
- **Backups**: esta BD es el insumo del ML; programa un `pg_dump` periódico.
- **No exponer**: datos personales (cédulas, emails, teléfonos, consentimientos).
