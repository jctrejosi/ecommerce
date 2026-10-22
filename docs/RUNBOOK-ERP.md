# Runbook — ERP Advantage (FORTUNER) ⇄ ecommerce

Operación de la sincronización **en vivo** entre el ecommerce (Postgres) y el
ERP Advantage que corre en `dsi-vps`. Diseño: `PLAN-SINCRONIZACION-ERP.md`.

> **Actualizado 2026-10-22.** La vía real ya **no** es OpenADS: se escribe y lee
> con `asqlcmd64.exe` contra el servicio ADS del ERP. OpenADS quedó sólo como
> banco de pruebas con una copia (`db/ads/openads/data-test`).

---

## 1. Arquitectura

```
Cliente / Admin / Bot
        │
        ▼
Backend NestJS ──► PostgreSQL ecommerce (:5432, contenedor ecommerce_postgres)
        │                         ▲
        │                         │ erp-daemon.mjs
        │                         ▼
        └──────────► Servicio ADS 12 (TCP 127.0.0.1:6262)
                              │
                              ▼
                 C:\ADD_FORTUNER\PUBLIDATA.add
```

- **ERP**: Advantage 12, servicio Windows `Advantage`
  (`C:\Program Files\Advantage 12.0\Server\ADS.EXE`), escuchando `0.0.0.0:6262`.
  Base: `C:\ADD_FORTUNER\PUBLIDATA.add` (el `.add`, no la carpeta).
- **Puente**: `asqlcmd64.exe` (incluido con Advantage 12). No abre los `.adt`
  directamente, así el ERP y el ecommerce pueden leer/escribir a la vez.
- **Postgres**: el contenedor no publica `5432`; en el host hay un proxy
  `ecommerce_pg_proxy` (`127.0.0.1:5432 → ecommerce_postgres:5432`).
- **Scripts**: `scripts-agent/erp/`. **Demonio**: `erp-daemon.mjs`.

## 2. Conexión al ERP

Variables en `backend/.env.development.local` (las cargan los scripts vía
`scripts-agent/erp/lib.mjs`):

```dotenv
ERP_ADS_MODE=asqlcmd
ADS_CMD=C:\Program Files\Advantage 12.0\Server\asqlcmd64.exe
ADS_SERVER=TCP:127.0.0.1:6262
ADS_DATABASE=C:\ADD_FORTUNER\PUBLIDATA.add
ADS_USER=ADSSYS
ADS_PASS=
```

Prueba manual:

```bat
"C:\Program Files\Advantage 12.0\Server\asqlcmd64.exe" ^
  -S TCP:127.0.0.1:6262 ^
  -CS "Data Source=C:\ADD_FORTUNER\PUBLIDATA.add" ^
  -U ADSSYS -P "" ^
  -Q "SELECT COUNT(*) AS N FROM tidsal"
```

Notas:
- Sin `-CS` (o con `Data Source=C:\ADD_FORTUNER`) asqlcmd busca tablas libres y
  falla con `Error 5159` ("The table is a database table").
- **No** montes `C:\ADD_FORTUNER` en OpenADS/Docker mientras el ERP lo usa: dos
  motores sobre los mismos `.adt` pueden corromper los datos.
- Si `ERP_ADS_MODE` falta, los scripts caen silenciosamente en OpenADS
  (`http://localhost:18080`). El demonio **se niega a arrancar** en ese caso.

## 3. Migraciones y primera puesta en marcha

```bash
node scripts-agent/erp/init-db.mjs          # idempotente: tablas erp_* + triggers
node scripts-agent/erp/sync-catalog.mjs --reset-snapshot
node scripts-agent/erp/sync-categories.mjs --apply
```

`init-db.mjs` aplica `19` a `25`: integración, espejo de facturación, triggers de
precio/stock (`21`), maestras (`22`), estados de pedido (`23`), códigos FORTUNER
(`24`) y cambios de producto (`25`). En el servidor ya está aplicado.

`sync-categories.mjs` reconstruye el árbol de **`TIDTAB`** (no `TIDCATE`), crea
las marcas de `TIDMARCAS` y las que sólo aparecen en `TIDSAL.INMARCAP`, y
reasigna `product_categories` / `products.brand_id`. Es idempotente.

## 4. Qué se sincroniza

### ERP → Postgres (`sync-catalog.mjs`)

| ERP | Postgres |
|---|---|
| `TIDSAL` (51.938 filas, 21.613 artículos, sucursales 1/2/11) | `products`, `product_variants`, `prices`, `inventory`, `branch_products` |
| `TIDTAB` (231 nodos, `CTABCOD`/`CTABDES`/`CTABCOD1`) | `categories` (código, nombre, padre, nivel) |
| `TIDSAL.INMARCAP` + `TIDMARCAS` (`MCODIGO`/`MNOMBRE`) | `brands` + `products.brand_id` |
| `INTIPO` | `product_types` + `product_type_assignments` |
| `INVRVENTA1` / `INVRVENTA0` | `prices.price` / `compare_price` (por sucursal) |
| `INSALDO00` | `inventory.stock` (por sucursal) |
| `INALTO`/`INANCHO`/`INLARGO` (cm) | dimensiones en mm (`length_mm`, etc.) |

**Categorías**: `INCATE` no es fiable (vacío en 34.659 filas y con códigos viejos
que no existen en `TIDTAB`). `categoryOf()` usa `INCATE` sólo si existe en
`TIDTAB`; si no, deriva la categoría del **prefijo del SKU** (7 → 2 dígitos).

**Marcas**: `INMARCA` no coincide con `TIDMARCAS.MCODIGO`; se guarda como
atributo `marca-erp` y no se escribe. La relación real es `INMARCAP` (nombre).

### Postgres → ERP (`push-catalog.mjs` + `erp_outbox`)

Los triggers de `db/sql/21`, `22` y `25` encolan cambios hechos en el backend:

| Kind | Destino |
|---|---|
| `price` | `TIDSAL.INVRVENTA1` / `INVRVENTA0` |
| `stock` | `TIDSAL.INSALDO00` (por `INSUC`) |
| `brands` | `TIDMARCAS` + `TIDSAL.INMARCAP` |
| `categories` | `TIDTAB` (`CTABDES`; alta con `CTABCOD1` = padre) |
| `product_types` | `TIDTPRO` (`NOMBRE`/`HABILITA`) |
| `products` | `TIDSAL`: nombre, `INNOMBRE3/4`, `INEAN`, `INMARCAP`, `INTIPO`, atributos y dimensiones |
| `product_flags` | `TIDSAL.INACTIVO` (`A`/`I`; no pisa `S`) |
| `order_status` | `DOMDIA.FAESTADO` (+ `DOMITE.IFESTADO` al cancelar) |

`push-catalog.mjs` es dry-run por defecto; escribe con `--apply`.

### Pedidos (`push-orders.mjs`)

Escribe `DOMDIA` (cabecera) y `DOMITE` (ítems). Detalles del ERP real:
- `FAFCHFAC` e `IFFECHA` son **enteros** `YYYYMMDD` (no texto).
- Los importes (`FAVLRBRU`, `IFVLRUNI`, etc.) son `Double`: se envían como
  números, no como cadenas.
- `FACONTROL` = `orders.reference_code`; `FAPEDIDO` = `900000000 + id`.
- Los pedidos `DEMO-*` **no se envían** por defecto. Para probar:
  `node scripts-agent/erp/push-orders.mjs --include-demo --limit=5`.
- `--force --order=<id>` reenvía un pedido concreto (idempotente por `FACONTROL`).

## 5. Demonio y automatización

`erp-daemon.mjs`:
- **Pull** `sync-catalog` cada `ERP_PULL_SECONDS` (300 s).
- **Push** `push-catalog --apply`, `push-orders` y `reconcile --apply` cada
  `ERP_PUSH_SECONDS` (30 s).
- Los clientes **no** se empujan en el bucle (para no crear clientes de prueba
  en el ERP); se hace manualmente con `push-customers.mjs --apply`.

En el servidor corre como tarea de Windows **"Mercaldas ERP Sync"** (al iniciar,
como SYSTEM):

```bat
schtasks /Query  /TN "Mercaldas ERP Sync" /FO LIST
schtasks /Run    /TN "Mercaldas ERP Sync"
schtasks /End    /TN "Mercaldas ERP Sync"
```

El lanzador es `scripts-agent/erp/erp-sync.cmd` (reintenta cada 10 s si Node
sale). Log: `logs/erp-sync.log`.

Para probar un ciclo sin dejar el bucle:

```bash
node scripts-agent/erp/erp-daemon.mjs --once
```

## 6. Validación y diagnóstico

```sql
-- Postgres
SELECT kind, status, count(*) FROM erp_outbox GROUP BY 1,2;
SELECT count(*) FROM products;            -- 21.613
SELECT count(*) FROM product_images;      -- 15.597 (11.427 productos con imagen)

-- ERP (asqlcmd)
SELECT COUNT(*) AS N FROM tidsal;         -- 51.938
SELECT INSUC, COUNT(*) AS N FROM tidsal GROUP BY INSUC;
```

Prueba de ida y vuelta:
1. Editar un producto/precio en el admin (o `UPDATE` en Postgres).
2. Esperar ≤ 30 s y confirmar `erp_outbox.status='sent'`.
3. Consultar `TIDSAL`/`TIDMARCAS`/`TIDTAB` con asqlcmd.
4. Cambiar un precio en el ERP y esperar ≤ 5 min: `sync-catalog` lo baja a
   Postgres.

Errores comunes:

| Síntoma | Causa / solución |
|---|---|
| `Error 5159` | falta `-CS "Data Source=...\PUBLIDATA.add"` |
| `Invalid operand ... Target Data Type: <Integer>` | se envió texto a una columna numérica/fecha del ERP |
| `record not locked` | se intentó escribir vía OpenADS sobre la copia; usar asqlcmd |
| El cambio no llega al ERP | revisar `erp_outbox` (`pending`/`error`) y `last_error` |
| El pull trae menos filas | parser CSV: las comillas internas de asqlcmd no se escapan; el parser cierra el campo sólo con `"` seguida de coma/salto/EOF |
| Sucursales duplicadas (`1.000000...`) | `INSUC` numérico de asqlcmd; normalizar con `BRANCH_CODE()` |

## 7. Herramientas puntuales

```bash
# Re-basar el snapshot tras cambiar de transporte (OpenADS ⇄ asqlcmd)
node scripts-agent/erp/sync-catalog.mjs --reset-snapshot

# Forzar reasignación de categorías/marcas
node scripts-agent/erp/sync-categories.mjs --apply

# Reenviar un pedido concreto
node scripts-agent/erp/push-orders.mjs --order=352 --force

# Empujar clientes (manual, revisar antes)
node scripts-agent/erp/push-customers.mjs --apply --limit=50
```

> El catálogo sigue siendo propiedad del ERP: el ecommerce puede editar y subir
> cambios, pero la siguiente pasada de `sync-catalog` reconcilia con `TIDSAL`.
