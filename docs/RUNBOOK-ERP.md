# Runbook — conectar y operar la sincronización con el ERP

Guía para montar el ecommerce junto al ERP (Advantage) y dejar la
sincronización corriendo. Diseño y alcance: `PLAN-SINCRONIZACION-ERP.md`.

---

## 1. Componentes

```
Ecommerce (backend + interfaces) ── Postgres (ecommerce)
                                        ▲
                                        │  scripts-agent/erp/*.mjs
                                        ▼
                                 OpenADS (Docker) ── base Advantage del ERP
```

- **Postgres** del ecommerce: contenedor `ecommerce_postgres` (:5432).
- **OpenADS**: contenedor `openads-img` (:18080 HTTP, :16262 wire) montando
  `db/ads/openads/data` como `/data`. Es el puente hacia Advantage.
- **Scripts de sync**: `scripts-agent/erp/`.

## 2. Puesta en marcha

```bash
node dev.js                 # levanta Postgres + OpenADS (y siembra si falta)
node dev.js --erp-sync      # ídem + deja la salida PG→ERP en bucle (cada 30 s)
node scripts-agent/erp/init-db.mjs   # crea tablas erp_* + triggers + mapa de estados (idempotente)
```

`--erp-sync` arranca `scripts-agent/erp/sync-out.mjs --apply` en bucle (log en
`logs/erp-sync.log`, se detiene con `node dev.js --stop`). El intervalo se ajusta
con `--erp-interval=<seg>` o `ERP_SYNC_INTERVAL`. Requiere Advantage; con
`--no-advantage` se omite.

`init-db.mjs` aplica, en orden: `19_erp_integration.sql`, `20_erp_invoice_mirror.sql`,
`21_erp_catalog_outbox.sql` (triggers precio/stock), `22_erp_outbox_masters.sql`
(triggers marcas/categorías/tipos/producto/estado), `23_erp_order_status_map.sql`
(PK de `erp_code_map` + semilla de estados de pedido), `24_erp_code_map_fortuner.sql`
(códigos de FORTUNER) y `25_erp_product_outbox.sql` (cambios de tipo/categoría,
barcode/dimensiones y activación). Despliegue completo: `DESPLIEGUE-ERP-FORTUNER.md`.

Si OpenADS no tiene las tablas del ERP, cópialas a `db/ads/openads/data/`
(desde `db/ADD_ANALITICA/`). Los diccionarios frescos de FORTUNER viven en
`db/ads/fortuner-dicts/` y los usa `sync-codes.mjs`. Las tablas que usa el
ecommerce:
`tidsal`, `tidtab`, `tidcate`, `tidtpro`, `tidmarcas`, `tidbode`,
`pospago`, `poscli`. (Y `faddia`/`fapago` sólo si usas el espejo
opcional `sync-invoices.mjs --full`.)

## 3. Variables de entorno

Las lee el backend y los scripts (vía `backend/.env.development.local`):

| Variable | Defecto | Uso |
|---|---|---|
| `OPENADS_URL` | `http://localhost:18080` | **aquí se cambia al montar en el ERP** |
| `OPENADS_USER` / `OPENADS_PASS` | `dsi` / `dsi` | credenciales de OpenADS |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/ecommerce` | Postgres del ecommerce |
| `ADMIN_USER_ID` | `1` | auditoría de precios |
| `ERP_ADV_DATA` | `db/ads/openads/data` | carpeta Advantage montada por Docker (`C:/ADD_FORTUNER`) |
| `ERP_ADV_EXTERNAL` | — | `1` = no levantar Docker; usar el OpenADS de `OPENADS_URL` |
| `ERP_ADV_HTTP_PORT` / `ERP_ADV_WIRE_PORT` | `18080` / `16262` | puertos del OpenADS en Docker |
| `ERP_ORDER_PREFIX` | `9` | prefijo del número de pedido web (9 dígitos) |
| `ERP_FAESTADO` / `ERP_TIPODOM` / `ERP_BODEGA` / `ERP_IFTIPO` | `0` / `01` / `00` / `E` | códigos cerrados con FORTUNER |
| `ERP_SYNC_INTERVAL` | `30` | segundos entre ciclos de `sync-out` |
| `NODE_ENV` | — | en el servidor: `production` (los scripts leen `.env.production`/`.env`) |
| `DOTENV_CONFIG_PATH` | — | archivo `.env` explícito para los scripts del conector |

> **Montaje en el ERP real**: basta apuntar `OPENADS_URL` a la IP/puerto donde
> corra OpenADS (o `localhost` si es la misma máquina).

## 4. Sincronización

```bash
# Todo en modo seguro (trae del ERP; muestra lo que haría hacia el ERP)
node scripts-agent/erp/sync-all.mjs

# Todo, incluyendo escrituras hacia el ERP
node scripts-agent/erp/sync-all.mjs --apply
```

Pasos que corre `sync-all`:
`sync-codes → sync-catalog → sync-customers → push-customers → push-catalog →
push-orders → reconcile`.

`sync-catalog` es el pull del catálogo: lee `TIDSAL`, `TIDCATE` (categorías) y
`TIDMARCAS`/`INMARCAP` (marcas) y actualiza productos, precios, inventario,
categorías, marcas y tipos en Postgres. Es la vía para que un cambio hecho en
el ERP se refleje aquí.

Scripts individuales y su sentido: ver `scripts-agent/erp/README.md`.

### Primera carga de categorías y marcas

En una base nueva (o tras un cambio grande del catálogo del ERP), además de
`sync-all` conviene ejecutar una vez:

```bash
node scripts-agent/erp/sync-categories.mjs --apply
node scripts-agent/erp/remap-shelves.mjs --apply
```

El primero reconstruye el árbol `TIDCATE` y las marcas de `TIDMARCAS`, y
reasigna cada producto a su categoría/marca del ERP. El segundo traduce las
estanterías físicas a las categorías nuevas. Ambos son idempotentes.

## 5. Automatización

### Linux (cron)
```cron
*/5 * * * * cd /ruta/ecommerce && node scripts-agent/erp/sync-all.mjs --apply >> /var/log/erp-sync.log 2>&1
```

### Windows (donde vive el ERP)
- **Task Scheduler**: tarea cada N minutos que ejecute
  `node C:\ruta\ecommerce\scripts-agent\erp\sync-all.mjs --apply`.
- Como servicio: envolver con [NSSM](https://nssm.cc/) o `sc.exe` si se quiere
  el agente (y `node dev.js`) siempre arriba.

> Fase futura (tiempo real): triggers `DSI_EVENTO` en el ERP + endpoints
> `/erp/*` en el backend, para no depender del intervalo del cron.

### Mientras NO haya ERP real (probar con la copia OpenADS)

La entrada pesada (catálogo + 146k clientes) basta con correrla cada tanto. Lo
que debe fluir seguido es la **salida**, y para eso está el runner ligero.

Lo más simple es dejar que `dev.js` lo arranque junto al resto:

```bash
node dev.js --erp-sync                 # salida PG→ERP en bucle cada 30 s
node dev.js --erp-sync --erp-interval=15   # cada 15 s
```

O correrlo aparte:

```bash
# una vez
node scripts-agent/erp/sync-out.mjs --apply

# en bucle (cada 30 s) mientras se prueba
node scripts-agent/erp/sync-out.mjs --apply --loop=30
```

Así, cada transacción que se haga en el ecommerce (pedido, alta de cliente,
cambio de precio/stock) se envía a la copia OpenADS sin intervención manual.

## 6. Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| `ECONNREFUSED :18080` | OpenADS caído → `docker start openads-img` |
| `AdsOpenTable failed` / `could not find ... .dbf` | Falta la tabla en `db/ads/openads/data` (copiar `.adt`+`.adi`) |
| "authentication required" en el navegador | entrar con `http://localhost:18080/?_auth_user=dsi&_auth_pass=dsi` |
| Sync no ve cambios | el contenedor montó un `/data` distinto; revisar el bind mount |

## 7. Pendientes para producción

- **`CODCLI`**: hoy `push-customers.mjs` lo genera (`2999########`). Confirmar
  con el ERP su algoritmo real.
- **Enums**: `FAESTADO`/`IFESTADO` cerrados con datos reales (0/5/9 y
  vacío/5), `FATIPODOM=01`. `FACANALV` y `FADOCPAGO` siguen opcionales. El mapa
  vive en `db/sql/24_erp_code_map_fortuner.sql` y `sync-codes.mjs`; se ajusta con
  `UPDATE` a `erp_code_map`, sin tocar código.
- **Stock**: `push-catalog.mjs` pisa `INSALDO00`; lo correcto suele ser enviar
  **movimientos** de inventario.
- **Conflictos de propiedad**: definir quién gana cuando ambos editan
  (el campo de precio/stock se escribe en ambos sentidos).
