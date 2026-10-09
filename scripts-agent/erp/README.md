# Conector ERP (Advantage) ⇄ Postgres

Scripts que mantienen sincronizadas la base **Advantage del ERP** y **Postgres**
del ecommerce. Objetivo y alcance: `docs/PLAN-SINCRONIZACION-ERP.md`.

> Requisitos: OpenADS arriba (`node dev.js` levanta PostgreSQL + OpenADS) y las
> tablas del ERP presentes en `db/ads/openads/data` (el sembrado inicial no las
> trae todas: ver cada script).

## Syncs **requeridos** (lo que el ecommerce usa)

| Script | Dirección | Qué |
|---|---|---|
| `sync-all.mjs` | ambas | **Runner**: ejecuta todo en orden. Seguro por defecto; `--apply` escribe en el ERP. |
| `sync-codes.mjs` | ERP → PG | Diccionario `erp_code_map` (marcas, ciudades, tipos, impuestos, medios de pago, bodegas). |
| `sync-catalog.mjs` | ERP → PG | `products`/`product_variants`/`prices`/`inventory`/`branch_products` + marcas, tipos, categorías, atributos. |
| `sync-customers.mjs` | ERP → PG | Clientes `POSCLI` → `customers`. |
| `push-orders.mjs` | PG → ERP | `orders`/`order_items` → `DOMDIA`/`DOMITE`. |
| `push-customers.mjs` | PG → ERP | Clientes locales → `POSCLI` (asigna `CODCLI` provisional). |
| `push-catalog.mjs` | PG → ERP | Drena `erp_outbox` (precio/stock) → `TIDSAL`. |
| `reconcile.mjs` | ERP → PG | Factura del ERP → `invoices`/`orders` de *nuestros* pedidos. |

Los `push-*` y `reconcile` escriben en el ERP: por defecto van en **dry-run**;
hay que pasar `--apply` (o usar `sync-all.mjs --apply`).

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

## Utilidades

- `openads.mjs` — cliente HTTP del conector (OpenADS) + conexión Postgres.
- `lib.mjs` — codecs del formato Advantage (latin1, centinelas, fechas) y helpers.
- `init-db.mjs` — aplica `db/sql/19_erp_integration.sql`, `20_erp_invoice_mirror.sql` y `21_erp_catalog_outbox.sql` (idempotente).
- `analyze-brands.mjs` — diagnóstico de marcas.

## Variables de entorno

- `OPENADS_URL` (def. `http://localhost:18080`), `OPENADS_USER` (def. `dsi`), `OPENADS_PASS` (def. `dsi`).
- `DATABASE_URL` (def. `postgresql://postgres:postgres@localhost:5432/ecommerce`).
- `ADMIN_USER_ID` (def. `1`).
