# Productos — atributos y cobertura (inventario)

Documentación del catálogo de productos del ecommerce y **cuánto está poblado
campo por campo**, para saber qué falta por completar. Fuente: Postgres
`ecommerce` (2026-10-10). Significado de columnas según `docs/DATABASE.md` y el
mapeo ERP (`docs/PLAN-INTEGRACION-ERP.md`).

## Totales

- **Productos (`products`): 21.613**
- Variantes (`product_variants`): 21.613 → **1 variante por producto** (no hay tallas/tamaños).
- Marcas: 3.008 · Categorías: 173 · Tipos: 367 · Proveedores: 753 · Impuestos: 21.613.
- Imágenes: 15.597 en 11.427 productos. Medios: 15.705 (todos `local`).

---

## `products` (cabecera comercial) — 21.613

| Columna | Significado | Poblado | Falta |
|---|---|---:|---:|
| `id` | PK | 21.613 | — |
| `brand_id` | FK a `brands` (marca) | 21.613 | 0 |
| `external_id` | Código externo/ERP = `INARTIC` (15 díg.) | 21.613 | 0 |
| `name` | Nombre del producto | 21.613 | 0 |
| `slug` | Slug único para URL | 21.613 | 0 |
| `description` | Descripción (visible al cliente) | 21.613 | 0 |
| `product_type` | Estructura: `SIMPLE`/`VARIANTES` (no es la tabla `product_types`) | 21.613 (`SIMPLE`) | — |
| `sku_prefix` | Prefijo para generar SKUs | 21.613 | 0 |
| `plu` | PLU: código corto de caja/balanza (`NUMERO`) | 21.613 | 0 |
| `featured` | Destacado | 0 | **21.613** |
| `manufacturer` | Fabricante | 21.613 | 0 |
| `visibility` | Visibilidad (`PUBLIC`/`PRIVATE`) | 21.613 (`PUBLIC`) | — |
| `is_public` | Visible públicamente | 824 | **20.789** |
| `is_active` | Activo | 11.568 | **10.045** |
| `published_at` | Fecha de publicación | 21.613 | 0 |

> Cobertura "de identidad" (nombre, marca, ERP, PLU, descripción) al **100%**.
> Los banderines (`featured`, `is_public`, `is_active`) son de configuración, no de dato faltante.

## `product_variants` (variante única) — 21.613

| Columna | Significado | Poblado | Falta |
|---|---|---:|---:|
| `sku` | SKU = `INARTIC` | 21.613 | 0 |
| `barcode` | Código de barras EAN (`INEAN`) | 21.189 | **424** |
| `current_price` | Precio de venta actual | 21.613 | 0 |
| `current_compare_price` | Precio "antes" (tachado) | 1.824 | **19.789** |
| `cost_price` | Costo unitario (`INVRULTC`) | 20.193 | **1.420** |
| `length_mm` | Largo (mm) | 8.496 | **13.117** |
| `width_mm` | Ancho (mm) | 8.746 | **12.867** |
| `height_mm` | Alto (mm) | 8.740 | **12.873** |
| `is_active` | Activo | 21.613 | 0 |

> **Dimensiones**: solo ~39% → limita el cálculo de volumen para rutas.

## Medios e imágenes

| Dato | Poblado | Falta |
|---|---:|---:|
| Productos **con** imagen (`product_images`) | 11.427 | **10.186** |
| Imágenes con `is_cover` (portada) | 11.427 de 15.597 | 4.170 sin portada |
| `media` con dimensiones (`width`/`height`) | 15.689 de 15.705 | 16 |
| `media.alt_text` (texto alterno) | **37** de 15.705 | **15.668** |

`media`: 15.705, todas `status=active`, `media_type=image`, `provider=local`
(ruta tipo `/static/products/…`). `checksum`: 15.705.

## Precios y stock por sucursal

`prices` — 49.036 filas, **3 sucursales**:

| Dato | Poblado | Falta |
|---|---:|---:|
| `price` | 49.036 | 0 |
| `compare_price` | 3.081 | **45.955** |
| `cost` | 47.091 | **1.945** |

`inventory` — 51.938 filas:

| Dato | Poblado | Falta |
|---|---:|---:|
| `stock` ≠ 0 | 25.664 | 26.274 en cero |
| `reorder_point` | 51.938 | 0 |
| `minimum_stock` | 51.938 | 0 |
| `target_stock` | 0 | **51.938** |

`branch_products` — 51.938 filas: `is_available` 26.557 · `is_public` 2.152.

Stock total por sucursal: **S1 = 283.944 · S11 = 595.450 · S2 = 102.719**
(3 sucursales con catálogo; `branches` tiene 10, 3 activas).

## Atributos (EAV: `attributes` + `product_attributes`) — 159.913 valores

10 atributos definidos. **Cobertura sobre 21.613 productos:**

| # | Atributo | Significado | Poblado | Falta |
|---|---|---|---:|---:|
| 1 | Unidad de medida | UN/KG/LT… (`INUNIDAD`) | 21.612 | 1 |
| 2 | Presentación | Presentación (`INPRESEN`) | 21.510 | **103** |
| 3 | Nombre corto | Nombre para tickets (`INNOMBRE3`) | 21.611 | 2 |
| 4 | Unidades por empaque | Factor de empaque (`INEMBALAJE`) | 21.613 | 0 |
| 5 | EAN caja (EAN-14) | EAN-14 de caja (`INEAN14`) | 14.098 | **7.515** |
| 6 | Referencia fabricante | Nº de parte (`INPARTE`) | 3.919 | **17.694** |
| 7 | Registro sanitario INVIMA | Registro sanitario (`ININVIMA`) | 9.435 | **12.178** |
| 8 | CUM | Código único de medicamentos (`INCUM`) | 2.901 | **18.712** |
| 9 | Ubicación bodega | Ubicación física (`INUBIC`) | 21.601 | 12 |
| 19 | Categoría ERP (INCATE) | Categoría del ERP (`INCATE`) | 21.613 | 0 |

> `attribute_options` y `variant_attributes` están **vacías** (0 filas).

## Catálogos asociados (cobertura de asignación)

| Relación | Total | Nota |
|---|---:|---|
| `product_categories` | 21.613 | 1 por producto; **83** de 173 categorías usadas |
| `product_type_assignments` | 21.611 | 2 sin tipo; **319** de 367 tipos usados |
| `supplier_products` | 21.613 | proveedor por variante |
| `product_tax_classes` | 21.613 | 100% con tarifa de IVA |

Categorías sin uso: **90**. Tipos sin uso: **48**.

---

## Resumen de faltantes (para inventariar)

| Prioridad | Qué falta | Cantidad |
|---|---|---:|
| Alta | Productos **sin imagen** | 10.186 |
| Alta | Productos **sin dimensiones** (volumen/rutas) | ~12.900 |
| Media | Sin `barcode` (EAN) | 424 |
| Media | `media.alt_text` vacío | 15.668 |
| Media | Atributos: CUM / Ref. fabricante / EAN-14 / INVIMA incompletos | 18.712 / 17.694 / 7.515 / 12.178 |
| Baja | `compare_price` (precio "antes") | 19.789 |
| Baja | `cost_price` / `prices.cost` | 1.420 / 1.945 |
| Baja | `target_stock` (stock objetivo) | 51.938 |
| Config | `is_public` (visible en tienda) | 20.789 |
| Config | Categorías/tipos sin uso | 90 / 48 |

## Cómo recalcular esta cobertura

```bash
docker exec ecommerce_postgres psql -U postgres -d ecommerce -c "\
SELECT count(*) total,
       count(*) FILTER (WHERE current_price IS NOT NULL) precio,
       count(*) FILTER (WHERE length_mm IS NOT NULL) largo
FROM product_variants"
```

Ver también: `docs/DATABASE.md` (esquema completo) y `db/objects/README.md`
(objetos físicos de estas tablas).
