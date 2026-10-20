# Objetos físicos de Postgres (`db/objects/`)

Copia **tal cual en disco** (heap + `_fsm` + `_vm`) de las tablas de
**productos** del ecommerce, extraída del contenedor `ecommerce_postgres`.
No es un export (`pg_dump`/`COPY`): son los segmentos reales de
`$PGDATA/base/<oid>/<relfilenode>`.

- Base: `ecommerce` (`oid = 19933`), motor `postgis/postgis:16-3.4` (PostgreSQL 16).
- Ruta dentro del contenedor: `/var/lib/postgresql/data/base/19933/<relfilenode>`.
- Total: **178 MB**. Los binarios están en `.gitignore` (solo se versionan este README y el manifiesto).

## Manifiesto

`ecommerce/MANIFEST.tsv`:

| Tabla | relfilenode | Heap (bytes) |
|---|---:|---:|
| `products` | 23524 | 36.159.488 |
| `product_variants` | 23516 | 12.886.016 |
| `product_images` | 23473 | 1.236.992 |
| `media` | 23225 | 4.939.776 |
| `product_attributes` | 23435 | 51.134.464 |
| `attributes` | 22849 | 8.192 |
| `prices` | 23433 | 28.729.344 |
| `inventory` | 23156 | 21.012.480 |
| `branch_products` | 41026 | 15.908.864 |
| `product_categories` | 23471 | 3.956.736 |
| `product_types` | 23511 | 204.800 |
| `product_type_assignments` | 23506 | 4.661.248 |
| `brands` | 22911 | 425.984 |
| `suppliers` | 23713 | 90.112 |
| `supplier_products` | 23711 | 4.055.040 |
| `categories` | 22938 | 155.648 |
| `branches` | 22903 | 8.192 |

Cada tabla tiene además `<node>_fsm` (free space map) y, casi siempre, `<node>_vm`
(visibility map). Los TOAST de estas tablas están **vacíos** (no se copiaron).
Los **índices** no se copian (son regenerables desde el heap).

## Cómo se generó / regenerar

```bash
# set de productos (por defecto del script)
bash scripts-agent/pg-objects-dump.sh db/objects

# tablas concretas
bash scripts-agent/pg-objects-dump.sh db/objects orders payments
```

El script (`scripts-agent/pg-objects-dump.sh`) resuelve `relfilenode` vía
`pg_class`, copia heap + `_fsm` + `_vm` y escribe `MANIFEST.tsv`.
Variables: `PG_CONTAINER` (def. `ecommerce_postgres`), `PG_DB` (def. `ecommerce`),
`PG_USER` (def. `postgres`).

## Inventario de datos de producto (estado actual)

| Tabla | Filas | Grano |
|---|---:|---|
| `products` | 21.613 | 1 por artículo |
| `product_variants` | 21.613 | 1:1 por producto |
| `product_images` | 15.597 | N por producto |
| `media` | 15.705 | todas `provider=local` (`/static/products/...`) |
| `product_attributes` | 159.913 | EAV (10 atributos) |
| `prices` | 49.036 | variante × sucursal |
| `inventory` / `branch_products` | 51.938 | variante × sucursal |
| `product_categories` | 21.613 | 1 por producto |
| `product_type_assignments` | 21.611 | 1 por producto |
| `categories` | 173 | árbol |
| `product_types` | 367 | catálogo |
| `brands` | 3.008 | catálogo |
| `suppliers` / `supplier_products` | 753 / — | catálogo |

Cobertura:
- `products`: marca/descripción/fabricante/plu **100%**; `is_active` **11.568**; `is_public` **824**.
- `product_variants`: `current_price` **100%**, `compare_price` 1.824, `cost_price` 20.193,
  `barcode` 21.189, **dimensiones (L×A×A) solo 8.479** (~39%).
- Imágenes: **11.427 productos con imagen / 10.186 sin imagen**.
- Stock por sucursal: S1 = 283.944 · S11 = 595.450 · S2 = 102.719.

## Limitaciones (importante)

- **No es una tabla portable.** El heap guarda tuplas con cabeceras MVCC
  (xmin/xmax/cid), huecos y referencias a TOAST/índices. Abrirlo requiere **el
  catálogo** (`base/<oid>` + `global/`) y el mismo motor/versión.
- **Version/especificidad:** layout de página dependiente de PG 16 y del
  endianness. No es formato de intercambio.
- **Consistencia:** copiado con la base viva; puede haber páginas a medio escribir.
  Para una copia físicamente consistente usar `pg_basebackup` (clúster completo).
- Para llevarse una tabla **usable**: `pg_dump -t <tabla>` o
  `COPY <tabla> TO ... WITH (FORMAT binary)`.

## Relación con `db/pg-raw/`

`db/pg-raw/` contiene la extracción puntual de `orders` hecha antes (mismo
formato). `db/objects/` es el conjunto de producto con el script reutilizable.
