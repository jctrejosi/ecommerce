# db/ — Base de datos y migraciones

Carpeta de soporte de base de datos del ecommerce. Contiene la configuración
del PostgreSQL local, scripts SQL manuales, los scripts de migración/recuperación
y todos los backups.

```
db/
├── README.md                      ← este archivo
├── docker/                        ← PostgreSQL local (Docker)
│   ├── docker-compose.yml         ←   contenedor postgis/postgis:16-3.4 (puerto 5432)
│   └── init.sql                   ←   extensiones: postgis, citext, uuid-ossp
├── sql/                           ← scripts SQL manuales (schema antiguo + datos demo)
│   ├── 01_schema.sql              ←   schema completo escrito a mano (legacy)
│   ├── 02_add_products.sql        ←   productos demo con imágenes dummy
│   └── create-db.ps1              ←   aplica 01_schema.sql al contenedor (PowerShell)
├── scripts/                       ← migraciones y recuperación (Node.js)
│   ├── migrate-local-to-supabase.mjs  ← copia tabla por tabla local → Supabase
│   ├── migrate-to-prod.mjs            ← migración local → prod vía pg_dump/pg_restore (Docker)
│   ├── recover-product-images.mjs     ← re-asocia imágenes de productos desde un backup
│   ├── recover-images-cloudinary.mjs  ← verifica/recupera imágenes por patrón de URL en Cloudinary
│   ├── recover-images-cloudinary-api.mjs ← recupera imágenes vía Cloudinary Admin API
│   └── recover-hero-popup.mjs         ← recupera banners hero/promo, popup y saved_filters
└── backups/
    ├── local/                     ← dumps de la BD local (formato pg_dump -F c)
    │   ├── ecommerce_local.backup            ← ⭐ catálogo 2430 productos CON imágenes (fuente de la restauración)
    │   ├── ecommerce_local_2026-08-11T20-44-01.backup
    │   └── ecommerce_safety_091622.backup    ← seguridad pre-restauración (12/08)
    ├── prod/                      ← dumps de producción (Railway anterior)
    │   ├── ecommerce_prod_backup_before.backup
    │   └── ecommerce_prod_before_2026-08-11T20-44-01.backup   ← 0 bytes (dump fallido)
    └── supabase/                  ← snapshots JSON de Supabase antes de cada migración
        └── supabase_before_*.json
```

## Levantar la BD local (Docker)

```bash
docker compose -f db/docker/docker-compose.yml up -d
```

Conexión local: `postgresql://postgres:postgres@localhost:5432/ecommerce`

## Esquema de la base

El esquema **real** vive en `backend/drizzle/schema.ts` (Drizzle ORM). Los
`db/sql/*.sql` son scripts legacy/manuales (schema antiguo y datos de ejemplo)
que ya no se usan para crear la BD de producción — esa se gestiona con
`drizzle-kit push`.

> ⚠ **Extensiones requeridas en producción (Supabase):** el buscador del
> catálogo usa `unaccent()` (insensible a tildes/ñ), `pg_trgm` (búsqueda
> difusa / tolerante a tipeos) y la función `public.immutable_unaccent()`
> (wrapper IMMUTABLE de `unaccent()` para poder indexarla). Si no existen,
> `POST /catalog/products` con `search` responde 500. Habilítalas una vez:
> ```sql
> CREATE EXTENSION IF NOT EXISTS unaccent;
> CREATE EXTENSION IF NOT EXISTS pg_trgm;
> CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
> RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT public.unaccent($1) $$;
> ```
> (en el SQL editor de Supabase o con el rol `postgres`). En local las crea
> `db/docker/init.sql`. También puedes ejecutar
> `DATABASE_URL='...' node backend/scripts/install-extensions.js`.

## Migraciones

| Script | Origen → Destino | Cómo se ejecuta |
|--------|------------------|-----------------|
| `migrate-local-to-supabase.mjs` | Local → Supabase | `PROD_DATABASE_URL='...' node scripts/migrate-local-to-supabase.mjs --yes` (Supabase: `TARGET_DB_SSL=1` vía variable) |
| `migrate-to-prod.mjs` | Local → prod (pg_dump/pg_restore) | `PROD_DATABASE_URL='...' node scripts/migrate-to-prod.mjs` |

El flujo usado actualmente es `migrate-local-to-supabase.mjs` (dos fases:
trunca todo → inserta todo, con `session_replication_role = replica` para
desactivar FKs). Genera un snapshot JSON previo en `backups/supabase/`.

## Recuperación de imágenes

Los scripts de recuperación leen de una BD temporal restaurada desde
`backups/local/ecommerce_local.backup` (que contiene el catálogo de 2430
productos con sus imágenes Cloudinary).

| Script | Qué recupera | Matching |
|--------|--------------|----------|
| `recover-product-images.mjs` | Imágenes de productos | external_id → plu → nombre (desde backup) |
| `recover-images-cloudinary.mjs` | Imágenes de productos | Verifica URLs `products/<plu>/prod_<eid>` en Cloudinary |
| `recover-images-cloudinary-api.mjs` | Imágenes de productos | Lista assets vía Cloudinary Admin API |
| `recover-hero-popup.mjs` | Banners hero/promo + popup + saved_filters | Copia media/banners/popups desde backup |

> Requieren la BD temporal `backup_inspect` restaurada desde
> `backups/local/ecommerce_local.backup`:
> ```bash
> docker exec ecommerce_postgres createdb -U postgres backup_inspect
> docker cp db/backups/local/ecommerce_local.backup ecommerce_postgres:/tmp/backup.backup
> docker exec ecommerce_postgres pg_restore -U postgres -d backup_inspect --no-owner --no-privileges /tmp/backup.backup
> ```
> Destino: `TARGET_DATABASE_URL='...'` (+ `TARGET_DB_SSL=1` para Supabase).

## Imágenes desde internet (productos sin foto)

Pipeline de rastreo de URLs candidatas → descarga → limpieza de fondo →
enlace a BD: ver `scripts-agent/image-sourcing/README.md`. Los artefactos de
rastreo viven en `db/image-sourcing/` (`candidates.ndjson`, `summary.json`).

## Backups

- **`backups/local/ecommerce_local.backup`** — el más importante: contiene el
  catálogo completo (2430 productos, 2503 media, imágenes Cloudinary). Fue la
  fuente para restaurar la tienda tras perder las imágenes.
- **`backups/local/ecommerce_safety_091622.backup`** — estado de la BD justo
  antes de restaurar el catálogo (12/08).
- **`backups/supabase/*.json`** — snapshot de Supabase generado automáticamente
  por cada ejecución de `migrate-local-to-supabase.mjs` (rollback de datos).
