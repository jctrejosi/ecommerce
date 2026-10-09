# Conector ERP (Advantage) ⇄ Postgres

Scripts que mantienen sincronizadas la base **Advantage del ERP** y **Postgres**
del ecommerce. Objetivo y alcance: `docs/PLAN-SINCRONIZACION-ERP.md`.

> Requisitos: OpenADS arriba (`node dev.js` levanta PostgreSQL + OpenADS) y las
> tablas del ERP presentes en `db/ads/openads/data` (el sembrado inicial no las
> trae todas: ver cada script).

## Syncs **requeridos** (lo que el ecommerce usa)

| Script | Dirección | Qué |
|---|---|---|
| `sync-all.mjs` | ambas | **Runner completo**: entrada pesada + salida. Seguro por defecto; `--apply` escribe en el ERP. |
| `sync-out.mjs` | ambas | **Runner de salida ligero** (clientes/precio-stock/pedidos/reconcile), para bucle/cron. |
| `sync-codes.mjs` | ERP → PG | Diccionario `erp_code_map` (marcas, ciudades, tipos, impuestos, medios de pago, bodegas). |
| `sync-catalog.mjs` | ERP → PG | `products`/`product_variants`/`prices`/`inventory`/`branch_products` + marcas, tipos, categorías, atributos. |
| `sync-customers.mjs` | ERP → PG | Clientes `POSCLI` → `customers`. |
| `push-orders.mjs` | PG → ERP | `orders`/`order_items` → `DOMDIA`/`DOMITE`. |
| `push-customers.mjs` | PG → ERP | Clientes locales → `POSCLI` (crea o actualiza; `CODCLI` provisional). |
| `push-catalog.mjs` | PG → ERP | Drena `erp_outbox`: precio/stock → `TIDSAL`; marcas → `TIDMARCAS`; categorías → `TIDTAB`; tipos → `TIDTPRO`; producto (nombre) → `TIDSAL`; estado de pedido → `DOMDIA.FAESTADO`. |
| `reconcile.mjs` | ERP → PG | Factura del ERP → `invoices`/`orders` de *nuestros* pedidos. |

Los `push-*` y `reconcile` escriben en el ERP: por defecto van en **dry-run**;
hay que pasar `--apply` (o usar `sync-all.mjs --apply`).

### Salida PG → ERP: `erp_outbox`

Los cambios hechos en el backend encolan en `erp_outbox` vía triggers y los drena
`push-catalog.mjs`. Guardia anti ping-pong: los scripts de entrada ponen
`app.erp_sync='on'` para que traer algo del ERP no lo reencole.

| Kind | Trigger (migración) | Destino ERP |
|---|---|---|
| `price` | `21` (`product_variants`) | `TIDSAL.INVRVENTA1/0` |
| `stock` | `21` (`inventory`) | `TIDSAL.INSALDO00` (por sucursal) |
| `brands` | `22` | `TIDMARCAS` |
| `categories` | `22` | `TIDTAB` |
| `product_types` | `22` | `TIDTPRO` |
| `products` | `22` | `TIDSAL.INNOMBRE` |
| `order_status` | `22` (`orders.status`) | `DOMDIA.FAESTADO` (vía `erp_code_map` dominio `order_status`) |

## Syncs **opcionales / de análisis** (el ecommerce NO los usa)

| Script | Qué | Nota |
|---|---|---|
| `sync-invoices.mjs` | Espejo 1:1 de `FADDIA`/`FAPAGO` → `erp_invoices`/`erp_payments`. | **Gated**: requiere `--full`. Sólo se conserva por análisis; la conciliación de *nuestros* pedidos es la Fase B. |

## Lo que **NO** se sincroniza (a propósito)

- `FADCLI` (clientes de facturación) — es del POS/facturación.
- `TIDTIPOS` como `tax_rates` — el carrito usa las 3 tarifas existentes.
- Listas de precio `INVRVENTA2..10` — sólo se usa la lista 1 (+ `INVRVENTA0` "antes").
- POS (`POSMENU`, `POSARCA`, `POSCAJA`, `POSDCTO*`, `PUBLIDATA`, `NOMCALEN`, …).
- `FADITE` (detalle de línea, 5,7 GB) — sólo verificación puntual.

## Reglas de propiedad / conflictos

- **Catálogo**: el ERP es dueño; nuestro push lo pisa (decisión aceptada). El
  guardia `app.erp_sync='on'` evita el ping-pong al traer algo del ERP.
- **Clientes**: un cliente `provider='local'` es del ecommerce y `sync-customers`
  **no lo sobrescribe** (evita revertir ediciones locales tras subirlo); los
  `provider='ERP'` sí se actualizan desde el ERP.
- **Tipos de producto**: `push-catalog` los **actualiza** por `CODIGO`; no los
  crea (el ERP es dueño de `TIDTPRO` y su `CODIGO` es de 3 caracteres con
  significado propio). Si el tipo no tiene código, el evento queda en `error`.
- **Producto**: `push-catalog` propaga el **nombre** (`TIDSAL.INNOMBRE`). Los
  flags de visibilidad/estado del artículo (`TIDSAL.INACTIVO` = `A`/`I`/`S`,
  `INWEB`/`SACATWEB`, `INAPP`) se dejan **del lado del ERP** (afectan al POS y
  su semántica exacta está pendiente de confirmar en sitio).

## Utilidades

- `openads.mjs` — cliente HTTP del conector (OpenADS) + conexión Postgres.
- `lib.mjs` — codecs del formato Advantage (latin1, centinelas, fechas) y helpers.
- `init-db.mjs` — aplica las migraciones ERP (idempotente):
  `19_erp_integration.sql`, `20_erp_invoice_mirror.sql`,
  `21_erp_catalog_outbox.sql` (triggers precio/stock),
  `22_erp_outbox_masters.sql` (triggers marcas/categorías/tipos/producto/estado),
  `23_erp_order_status_map.sql` (PK de `erp_code_map` + semilla `order_status`).
- `analyze-brands.mjs` — diagnóstico de marcas.

## Variables de entorno

- `OPENADS_URL` (def. `http://localhost:18080`), `OPENADS_USER` (def. `dsi`), `OPENADS_PASS` (def. `dsi`).
- `DATABASE_URL` (def. `postgresql://postgres:postgres@localhost:5432/ecommerce`).
- `ADMIN_USER_ID` (def. `1`).
