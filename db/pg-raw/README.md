# Archivos físicos crudos de Postgres (`db/pg-raw/`)

Copia **tal cual** (byte a byte) de los archivos que Postgres guarda en disco
para una tabla del ecommerce, extraídos del contenedor `ecommerce_postgres`.
No es un export lógico (`pg_dump`/`COPY`): son los segmentos heap reales.

> ⚠️ Son solo para inspección/formato. **No** son una tabla usable por sí solos
> (ver *Limitaciones*). Los binarios están en `.gitignore`; solo se versiona este README.

## Extraído: `ecommerce.orders` (2026-10-10)

- Base: `ecommerce` (`oid = 19933`), motor `postgis/postgis:16-3.4` (PostgreSQL 16).
- `PGDATA` en el contenedor: `/var/lib/postgresql/data`.
- Ruta dentro del contenedor: `/var/lib/postgresql/data/base/19933/<relfilenode>`.

| Archivo local | relfilenode | Objeto | Tipo | Bytes | sha256 (primeros 16) |
|---|---|---|---|---|---|
| `ecommerce/32601` | 32601 | `orders` | heap (datos) | 106496 | `73cc04cf00490fd0` |
| `ecommerce/32601_fsm` | 32601 | `orders` | free space map | 24576 | |
| `ecommerce/32601_vm` | 32601 | `orders` | visibility map | 8192 | |
| `ecommerce/32602` | 32602 | `pg_toast_22455` | TOAST (vacío) | 0 | |
| `ecommerce/32608` | 32608 | `orders_pkey` | índice btree | 32768 | `67311f8394a6d858` |

Cómo se obtuvieron los `relfilenode`:

```sql
SELECT c.relname, c.relfilenode, c.relkind, pg_relation_size(c.oid)
FROM pg_class c
WHERE c.relname IN ('orders','orders_pkey')
   OR c.oid = (SELECT reltoastrelid FROM pg_class WHERE relname='orders');
```

## Cómo (re)extraer otra tabla

```bash
DB=ecommerce
# 1) oid de la base
docker exec ecommerce_postgres psql -U postgres -d $DB -tAc \
  "SELECT oid FROM pg_database WHERE datname='$DB'"
# 2) relfilenode(s) de la tabla (y su TOAST)
docker exec ecommerce_postgres psql -U postgres -d $DB -tAc \
  "SELECT relname, relfilenode, relkind FROM pg_class WHERE relname='<tabla>'"
# 3) copiar heap + mapas (los _fsm/_vm pueden no existir)
BASE=/var/lib/postgresql/data/base/<OID>
docker cp ecommerce_postgres:$BASE/<NODE>    db/pg-raw/$DB/<NODE>
docker cp ecommerce_postgres:$BASE/<NODE>_fsm db/pg-raw/$DB/<NODE>_fsm
docker cp ecommerce_postgres:$BASE/<NODE>_vm  db/pg-raw/$DB/<NODE>_vm
```

## Limitaciones (importante)

- **No es una tabla portable.** El heap guarda tuplas con cabeceras MVCC
  (xmin/xmax/cid), huecos de espacio libre, filas muertas y punteros a TOAST.
  Por sí solo no se puede abrir ni consultar: se necesita **el catálogo**
  (`pg_class`/`pg_attribute`, en `base/<oid>` y `global/`) y el mismo motor/versión.
- **Referencias externas:** columnas TOAST viven en la relación `pg_toast_*`
  (aquí vacía); los índices apuntan a `ctid` del heap, no son autocontenidos.
- **Version/especificidad de máquina:** el layout de página depende de la versión
  (16) y del endianness/alineación. No es un formato de intercambio.
- **Consistencia:** copiar el archivo con la base viva puede capturar páginas a
  medio escribir. Para una copia físicamente consistente: `pg_basebackup` (o
  detener la base) — eso copia el clúster completo, no una tabla.

## Si lo que se quiere es "llevarse la tabla"

- **Lógica y usable** (recomendado): `pg_dump -t orders` (SQL/`-Fc`), o
  `COPY orders TO ... WITH (FORMAT binary)` (representación binaria **de la tabla**,
  portable entre mismas versiones de PG).
- **Clúster completo físico**: `pg_basebackup`.
- Lo de este directorio es el **archivo tal cual en disco**, útil para estudiar
  el formato/páginas, no para restaurar.
