# Conector ERP (Advantage) ⇄ Postgres

Scripts que mantienen sincronizadas la base **Advantage del ERP** y **Postgres**
del ecommerce. Objetivo y alcance: `docs/PLAN-SINCRONIZACION-ERP.md`.

> **Vía real (dsi-vps):** `asqlcmd64.exe` contra el servicio ADS 12 y la base
> `C:\ADD_FORTUNER\PUBLIDATA.add`. OpenADS sólo se usa como banco de pruebas con
> una copia. Configuración y operación: `docs/RUNBOOK-ERP.md`.

## Syncs **requeridos** (lo que el ecommerce usa)

| Script | Dirección | Qué |
|---|---|---|
| `erp-daemon.mjs` | ambas | **Demonio**: pull de catálogo cada 5 min + pull de maestras (clientes y proveedores) cada 15 min + push cada 30 s (tarea de Windows). |
| `erp-sync.cmd` | — | Lanzador del demonio con reintento (lo usa la tarea "Mercaldas ERP Sync"). |
| `sync-all.mjs` | ambas | **Runner completo**: entrada pesada + salida. Seguro por defecto; `--apply` escribe en el ERP. |
| `sync-out.mjs` | ambas | **Runner de salida ligero** (clientes/precio-stock/pedidos/reconcile), para bucle/cron. |
| `sync-codes.mjs` | ERP → PG | Diccionario `erp_code_map` desde `db/ads/fortuner-dicts` (marcas, tipos, impuestos, medios de pago, bodegas, estados). No necesita OpenADS. |
| `sync-catalog.mjs` | ERP → PG | `products`/`product_variants`/`prices`/`inventory`/`branch_products` + tipos, categorías (**`TIDTAB`**), marcas (`TIDMARCAS`/`INMARCAP`), atributos e impuestos (`TIDTIPOS` → `tax_rates`). `--reset-snapshot` re-basa todo. |
| `sync-masters.mjs` | ERP → PG | **Maestros en vivo** (no `.ADT`): marcas `TIDMARCAS`, tipos `TIDTPRO`, categorías `TIDTAB` y bodegas `TIDBODE`, upsert **por código** con renombre. `--prune` desactiva bajas; `--types-active=erp` copia `HABILITA`. |
| `sync-categories.mjs` | ERP → PG | **Migración única**: árbol de **`TIDTAB`** → `categories`, `TIDMARCAS` + `INMARCAP` → `brands`, y reasigna `product_categories`/`products.brand_id`. Oculta las categorías viejas sin uso. |
| `remap-shelves.mjs` | PG | **Migración única**: traduce `shelf_categories` de categorías viejas a las hojas equivalentes (dry-run por defecto). |
| `sync-customers.mjs` | ERP → PG | Clientes `POSCLI` → `customers`. |
| `sync-suppliers.mjs` | ERP → PG | Proveedores `TIDLISTA.INPROVEE` + `CONTERCE` → `suppliers`, y `TIDLISTA` → `supplier_products` (corre en el ciclo lento del demonio, cada 15 min; también manual). |
| `push-orders.mjs` | PG → ERP | `orders`/`order_items` → `DOMDIA`/`DOMITE`. Por defecto omite `DEMO-*` (`--include-demo` para probar). |
| `push-customers.mjs` | PG → ERP | Clientes locales → `POSCLI` (crea o actualiza; `CODCLI` generado de 13 chars). |
| `push-catalog.mjs` | PG → ERP | Drena `erp_outbox`: precio/stock → `TIDSAL`; marcas → `TIDMARCAS` (+ `TIDSAL.INMARCAP`); categorías → **`TIDTAB`**; tipos → `TIDTPRO`; producto (nombre, barcode, dimensiones y atributos ERP) → `TIDSAL`; activación → `TIDSAL.INACTIVO`; estado de pedido → `DOMDIA.FAESTADO` y, al cancelar, `DOMITE.IFESTADO`. |
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
| `categories` | `22` | `TIDTAB` (`CTABDES` por `CTABCOD`; alta con `CTABCOD1` = padre) |
| `product_types` | `22` | `TIDTPRO` |
| `products` | `22` + `25` (producto, tipo, categoría, atributos, barcode/dimensiones) | `TIDSAL.INNOMBRE/INNOMBRE3/INNOMBRE4`, `INEAN`, `INMARCAP`, `INTIPO`, `INUNIDAD/INPRESEN/INEMBALAJE/INPARTE/ININVIMA/INCUM/INUBIC/INEAN14`, `INLARGO/INANCHO/INALTO` (sin `INCATE`) |
| `product_flags` | `25` (`is_active` de producto/variante) | `TIDSAL.INACTIVO` (`A`/`I`; no pisa `S`) |
| `order_status` | `22` (`orders.status`) | `DOMDIA.FAESTADO` + `DOMITE.IFESTADO` (vía `erp_code_map`) |

## Syncs **opcionales / de análisis** (el ecommerce NO los usa)

| Script | Qué | Nota |
|---|---|---|
| `sync-invoices.mjs` | Espejo 1:1 de `FADDIA`/`FAPAGO` → `erp_invoices`/`erp_payments`. | **Gated**: requiere `--full`. Sólo se conserva por análisis; la conciliación de *nuestros* pedidos es la Fase B. |

## Lo que **NO** se sincroniza (a propósito)

- `FADCLI` (clientes de facturación) — es del POS/facturación.
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
- **Producto**: `push-catalog` propaga nombre corto/largo (atributos
  `nombre-corto`/`nombre-largo`), barcode, dimensiones, atributos ERP
  (`categoria-erp`, unidad, presentación, empaque, INVIMA, CUM, ubicación,
  EAN-14), marca por **nombre** (`INMARCAP`), tipo y estado (`INACTIVO` =
  `A`/`I`; `S` se respeta). **`INMARCA` no se toca**: en la copia no coincide
  con `TIDMARCAS.MCODIGO` (ver `docs/ESCRITURA-FORTUNER-READINESS.md`). Los
  flags de publicación web (`INWEB`/`SACATWEB`, `INAPP`) se dejan del lado del
  ERP y se leen al importar.

## Utilidades

- `asqlcmd.mjs` — cliente del servicio ADS vía `asqlcmd64.exe` (SQL, filas, esquema).
- `dict-fortuner-ads.mjs` — genera `db/add_fortuner_study/` leyendo `system.tables`/`system.columns` del ERP real (se corre en el servidor).
- `fortuner-tablas.mjs` — **nombre completo y descripción funcional de las 111 tablas** del ERP, más `renderReadme()`. Es la fuente de verdad de la prosa del diccionario; al aparecer una tabla nueva hay que agregarla aquí.
- `patch-table-metadata.mjs` — reaplica nombres y descripciones a `db/add_fortuner_study/` sin volver a leer la base (idempotente).
- `openads.mjs` — selector de transporte (`ERP_ADS_MODE=asqlcmd` o HTTP OpenADS) + conexión Postgres.
- `adt.mjs` — lector de tablas `.ADT` (diccionarios de FORTUNER).
- `lib.mjs` — codecs del formato Advantage, `BRANCH_CODE`, `orderNumber`, `newErpCode` y carga del `.env`.
- `init-db.mjs` — aplica las migraciones ERP (idempotente):
  `19_erp_integration.sql`, `20_erp_invoice_mirror.sql`,
  `21_erp_catalog_outbox.sql` (triggers precio/stock),
  `22_erp_outbox_masters.sql` (triggers marcas/categorías/tipos/producto/estado),
  `23_erp_order_status_map.sql` (PK de `erp_code_map`),
  `24_erp_code_map_fortuner.sql` (códigos reales de FORTUNER) y
  `25_erp_product_outbox.sql` (tipo/categoría, barcode/dimensiones, activación),
  `26_erp_branch_price_outbox.sql` (precio por sucursal) y
  `27_erp_master_keys.sql` (índices únicos parciales `brands.code`/`categories.code`).
- `analyze-brands.mjs` — diagnóstico de marcas.

## Notas de implementación

- `asqlcmd` devuelve CSV con comillas internas **sin escapar**; `parseAsqlcmd()`
  cierra un campo citado sólo cuando la comilla va seguida de coma, salto o EOF.
  No vuelvas a un parser CSV estándar: fusiona filas (se perdían ~23k).
- **`asqlcmd64.exe` es ANSI (Windows-1252), no UTF-8.** `asqlcmd.mjs` decodifica con
  `TextDecoder('windows-1252')` (ver `ANSI`). Antes se leía como UTF-8 y los
  acentuados (`Ñ`, `É`, `Á`, `Í`, `Ó`, `Ú`, `´` = bytes `0x80-0xFF`) se corrompían a
  `U+FFFD '�'`. Además, al **escribir** `�` en el ERP, se perdía como `?` (0x3F).
  Limpieza aplicada: se soft-deletearon las marcas `�` y `?` en Postgres y se
  corrigieron (UPDATE, sin borrar) los 62 nombres `?` de `TIDMARCAS`.
  `products`/`categories`/`product_variants.sku` quedaron en 0 `�`.
- **Blindaje anti-corrupción de marcas**: `sync-masters` ignora nombres con `?`/`�`
  y, al chocar nombre duplicado, **no pisa el `code` existente**
  (`code = COALESCE(code, $1)`) — así los duplicados del ERP (mismo nombre, dos
  códigos) no voltean el código canónico. `push-catalog` tampoco empuja marcas con
  nombre `?`/`�`.
- Los numéricos llegan como `1.000000000000000`; usa `BRANCH_CODE()` y `Number()`.
  `FAFCHFAC`/`IFFECHA` son enteros `YYYYMMDD`.
- `TOP/START AT` pagina correctamente una vez que el parser no pierde filas.

## Variables de entorno

- `ERP_ADS_MODE` (`asqlcmd` para el ERP real), `ADS_CMD`, `ADS_SERVER`,
  `ADS_DATABASE`, `ADS_USER`, `ADS_PASS`.
- `OPENADS_URL` (def. `http://localhost:18080`), `OPENADS_USER` (def. `dsi`),
  `OPENADS_PASS` (def. `dsi`) — sólo para el banco de pruebas.
- `DATABASE_URL` (def. `postgresql://postgres:postgres@localhost:5432/ecommerce`).
- `ERP_ADT_DIR` (def. `db/ads/fortuner-dicts`) — diccionarios `.ADT` de FORTUNER.
- `ERP_ORDER_PREFIX` (def. `9`) — prefijo del `FAPEDIDO`/`IFPEDIDO` web (9 dígitos).
- `ERP_NEW_CODE_PREFIX` (def. `9`) — prefijo de códigos nuevos de maestras.
- `ERP_PULL_SECONDS` (def. `300`), `ERP_PULL_SLOW_SECONDS` (def. `900`) y `ERP_PUSH_SECONDS` (def. `30`) — ritmo del demonio.
- `ADMIN_USER_ID` (def. `1`).
