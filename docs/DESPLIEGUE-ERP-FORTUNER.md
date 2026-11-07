# Despliegue — ecommerce junto a FORTUNER (ERP Advantage)

> **Actualización 2026-10-22 — ERP real conectado.** La vía operativa es
> `asqlcmd64.exe` contra el servicio ADS de `C:\ADD_FORTUNER\PUBLIDATA.add`.
> OpenADS queda sólo como banco de pruebas con una copia. Operación diaria:
> `docs/RUNBOOK-ERP.md`.

Guía para instalar el ecommerce en el servidor Windows donde vive el ERP y
dejar **cada transacción apuntando a las tablas reales de `C:\ADD_FORTUNER`**.

- Diseño de la integración: `docs/PLAN-INTEGRACION-ERP.md`
- Campos y códigos cerrados: `docs/ESCRITURA-FORTUNER-READINESS.md`
- Operación diaria y problemas: `docs/RUNBOOK-ERP.md`
- Checklist en sitio: `docs/CHECKLIST-ERP-SITIO.md`

---

## 1. Arquitectura

Hosts publicados por el contenedor:

| Host | Qué sirve |
|---|---|
| `mercaldas.jcti.xyz` | tienda + API en el mismo origen (`/catalog/*`, `/orders`, ...) |
| `api.mercaldas.jcti.xyz` | **API completa**; los bundles se compilan con `VITE_API_URL=https://api.mercaldas.jcti.xyz`. La raíz se reescribe a `/webhooks/wompi`. |
| `admin.mercaldas.jcti.xyz` | panel admin (Basic Auth opcional) |
| `picking-admin...` / `delivery-admin...` | paneles de picking y delivery |

```mermaid
graph TD
    A["Cliente / Admin / Bot"] --> B["Backend NestJS :3000"]
    B --> C[(PostgreSQL ecommerce :5432)]
    C --> D["erp-daemon.mjs<br/>pull 5 min · push 30 s"]
    D --> E["asqlcmd64.exe"]
    E --> F[("Servicio ADS 12 :6262<br/>C:\ADD_FORTUNER\PUBLIDATA.add")]
    F --> E
    E --> D
    D --> C
```

Flujo de una compra:

1. El cliente crea el pedido en el backend → `orders` + `order_items` en Postgres.
2. `erp-daemon` ejecuta `push-orders`: inserta cabecera en `DOMDIA` y líneas en `DOMITE`.
3. El ERP factura el pedido y actualiza `FAESTADO`/`FAFACTURA`.
4. `reconcile` lee esos cambios y actualiza `orders`/`invoices` en Postgres.

Flujo de una edición de producto en el admin:

1. El admin actualiza `products`, `product_variants`, `product_type_assignments`
   o `product_categories`.
2. Un trigger encola el cambio en `erp_outbox` (`kind='products'` o
   `'product_flags'`).
3. `push-catalog` lee el producto completo desde Postgres y actualiza `TIDSAL`
   (nombre, barcode, marca, tipo, dimensiones, estado). La categoría se mantiene
   en `TIDTAB` y en `product_categories` (el ERP real no usa `INCATE`).

---

## 2. Requisitos en el servidor

| Componente | Requisito |
|---|---|
| SO | Windows 10/11 o Windows Server 2019+ |
| Node.js | 20 o superior (`node --version`) |
| Docker | Docker Desktop con WSL2 (para PostgreSQL; OpenADS opcional como banco de pruebas) |
| Git | Para clonar/actualizar el proyecto |
| ERP | Servicio **Advantage 12** (`ADS.EXE`) y `asqlcmd64.exe`; base `C:\ADD_FORTUNER\PUBLIDATA.add` |
| Puertos | `5432` (Postgres), `3000` (API), `4173` (tienda), `8443` (admin), `6262` (ADS); `18080`/`16262` sólo si usas el OpenADS de pruebas |

> **Antes de escribir en el ERP real**: prueba todo contra una **copia** de
> `C:\ADD_FORTUNER` (por ejemplo `C:\ADD_FORTUNER_TEST`). Advantage crea archivos
> de bloqueo y journal; no montes el directorio vivo en dos motores a la vez.

---

## 3. Variables de entorno

Crea `backend/.env` (lo lee NestJS en producción) y, si vas a usar
`NODE_ENV=production`, `backend/.env.production` con el mismo contenido para los
scripts del conector. También puedes apuntar los scripts a un archivo explícito
con `DOTENV_CONFIG_PATH`.

```dotenv
NODE_ENV=production

# PostgreSQL del ecommerce
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ecommerce

# ERP real: servicio ADS 12 + asqlcmd (sin abrir los .adt)
ERP_ADS_MODE=asqlcmd
ADS_CMD=C:\Program Files\Advantage 12.0\Server\asqlcmd64.exe
ADS_SERVER=TCP:127.0.0.1:6262
ADS_DATABASE=C:\ADD_FORTUNER\PUBLIDATA.add
ADS_USER=ADSSYS
ADS_PASS=

# Numeración y códigos del ERP (valores cerrados con FORTUNER)
ERP_ORDER_PREFIX=9
ERP_FAESTADO=0
ERP_TIPODOM=01
ERP_BODEGA=00
ERP_IFTIPO=E

# Demonio: pull del catálogo y push de la cola
ERP_PULL_SECONDS=300
ERP_PUSH_SECONDS=30
```

Notas:

- `asqlcmd` **debe** llevar `-CS "Data Source=C:\ADD_FORTUNER\PUBLIDATA.add"`;
  sin eso busca tablas libres y falla con `Error 5159`.
- Si `ERP_ADS_MODE` falta, los scripts caen en OpenADS (`http://localhost:18080`).
  El demonio se niega a arrancar así para no escribir en la copia de pruebas.
- OpenADS (Docker) sólo sirve para explorar una copia. **No** montes
  `C:\ADD_FORTUNER` en Docker mientras el ERP lo usa: dos motores sobre los
  mismos `.adt` pueden corromper los datos.
- Si el backend y los scripts cargan archivos distintos, fuerza uno solo:
  `DOTENV_CONFIG_PATH=C:/ruta/ecommerce/backend/.env`.
- No subas `.env` reales a git.

---

## 4. Instalación paso a paso

### 4.1 Clonar y restaurar la base

```bat
git clone <repo> C:\mercaldas\ecommerce
cd C:\mercaldas\ecommerce
node dev.js --init
```

`--init`:

1. instala dependencias (pnpm y, si falla, npm),
2. restaura el snapshot más reciente de `db/backups/ecommerce` (si la base está
   vacía),
3. compila backend y webs.

Alternativa explícita:

```bat
node dev.js --migrate
```

### 4.2 Imágenes estáticas

Las imágenes **no** están en la base ni en git (pesan varios GB). Copia
`db/images_static/` al servidor conservando la ruta, o vuelve a extraer
`db/JPG2.zip` con el script de ingesta. Sin esto, la tienda y el APK no
mostrarán fotos aunque la BD tenga las rutas.

### 4.3 Migraciones y códigos ERP

Con PostgreSQL arriba:

```bat
node scripts-agent/erp/init-db.mjs
node scripts-agent/erp/sync-codes.mjs
node scripts-agent/erp/health.mjs
```

`init-db.mjs` es idempotente y aplica `19` a `25` de `db/sql` (tablas `erp_*`,
triggers de salida y mapa de códigos). `sync-codes.mjs` reconstruye
`erp_code_map` desde `db/ads/fortuner-dicts/` (marcas, tipos, pagos, bodegas,
impuestos, estados).

Para dejar el catálogo de Postgres igual al del ERP en la primera puesta en
marcha (categorías, marcas y asignaciones de producto):

```bat
node scripts-agent/erp/sync-catalog.mjs --reset-snapshot
node scripts-agent/erp/sync-categories.mjs --apply   :: TIDTAB + TIDMARCAS
```

- `sync-categories.mjs` es **idempotente**: crea/actualiza el árbol de
  **`TIDTAB`** (`CTABCOD`/`CTABDES`/`CTABCOD1`), crea las marcas de `TIDMARCAS`
  y las que sólo aparecen en `TIDSAL.INMARCAP`, y reasigna
  `product_categories` y `products.brand_id` de todos los artículos. Las
  categorías viejas que quedan sin productos ni referencias se ocultan.
- La categoría del artículo se deriva del **prefijo del SKU** cuando `INCATE` no
  existe en `TIDTAB` (que es lo habitual: `INCATE` está vacío o trae códigos
  viejos). `INCATE` no se escribe.
- `remap-shelves.mjs` sólo es necesario si hay estanterías físicas que apunten a
  categorías viejas. Va en dry-run por defecto; revisa el resumen antes de
  `--apply`.

En régimen normal no hace falta repetirlos: `sync-catalog.mjs` ya lee `TIDTAB` y
`TIDMARCAS` en cada pasada y mantiene categorías, marcas y asignaciones al día.
Es una entrada **pesada** (51.938 filas de `TIDSAL`, 21.613 artículos), por eso
el demonio la corre cada 5 minutos y el push cada 30 segundos.

> `db/ads/fortuner-dicts/` debe viajar con el proyecto. Si falta, `sync-codes`
> no puede mapear marcas/tipos/pagos.

### 4.4 Arrancar

El ecommerce se levanta con `prod.cmd` / `node dev.js --prod` (Docker: Postgres,
backend, tienda, admin, bot).

La sincronización con el ERP va **aparte**, como tarea de Windows:

```bat
schtasks /Run /TN "Mercaldas ERP Sync"     :: arrancar
schtasks /Query /TN "Mercaldas ERP Sync" /FO LIST
schtasks /End /TN "Mercaldas ERP Sync"     :: detener
```

La tarea ejecuta `scripts-agent/erp/erp-sync.cmd` → `erp-daemon.mjs` (pull cada
5 min, push cada 30 s). Log: `logs/erp-sync.log`.

Prueba de un solo ciclo:

```bat
node scripts-agent/erp/erp-daemon.mjs --once
```

> En el servidor **no** uses `node dev.js --erp-sync`: ese bucle antiguo apunta a
> OpenADS. El demonio de producción es `erp-daemon.mjs` con `ERP_ADS_MODE=asqlcmd`.

---

## 5. Prueba de humo

### 5.1 Producto → `TIDSAL`

1. En el admin, cambia el nombre o el código de barras de un producto.
2. Verifica que se encoló:

   ```sql
   SELECT id, kind, status, payload FROM erp_outbox
    WHERE status = 'pending' ORDER BY id DESC LIMIT 5;
   ```

3. Espera el ciclo (30 s) o fuerza:

   ```bat
   node scripts-agent/erp/push-catalog.mjs --apply --kind=products --limit=5
   ```

4. Consulta el ERP:

   ```sql
   SELECT INARTIC, INSUC, INNOMBRE, INNOMBRE3, INNOMBRE4,
          INEAN, INMARCA, INMARCAP, INTIPO, INCATE,
          INUNIDAD, INPRESEN, INEMBALAJE, INPARTE, INUBIC,
          INLARGO, INANCHO, INALTO, INACTIVO
     FROM TIDSAL
    WHERE INARTIC = '<SKU>';
   ```

   `INMARCA` se conserva tal cual (no se escribe); la marca que edita el admin
   viaja en `INMARCAP`. `INCATE` puede estar vacío: la categoría web se deriva del
   prefijo del SKU y se mantiene en `product_categories`/`TIDTAB`.

### 5.2 Compra → `DOMDIA` / `DOMITE`

1. Haz una compra desde la tienda (o crea el pedido por API).
2. Fuerza el envío:

   ```bat
   node scripts-agent/erp/push-orders.mjs --dry-run
   node scripts-agent/erp/push-orders.mjs
   ```

3. En el ERP:

   ```sql
   SELECT FAPEDIDO, FACONTROL, FAFCHFAC, FATIME, FAVLRNET, FAESTADO, FASUCUR
     FROM DOMDIA WHERE FACONTROL = '<reference_code>';

   SELECT IFPEDIDO, IFARTIC, IFCANT, IFVLRUNI, IFVLRBRU, IFVLRIVA, IFVLRNET, IFESTADO
     FROM DOMITE WHERE IFPEDIDO = '<FAPEDIDO>';
   ```

4. Cuando el ERP facture, corre `reconcile` y verifica que el pedido vuelva
   marcado en Postgres:

   ```bat
   node scripts-agent/erp/reconcile.mjs --apply
   ```

### 5.3 Estado de la integración

```bat
node scripts-agent/erp/health.mjs
```

Comprueba Postgres, eventos pendientes, `erp_code_map` y lectura de las tablas
clave (`tidsal`, `domdia`, `domite`, `pospago`, `tidmarcas`, `tidtpro`, `tidbode`).

---

## 6. Operación

| Tarea | Comando |
|---|---|
| Demonio (pull + push) | `node scripts-agent/erp/erp-daemon.mjs` |
| Un ciclo | `node scripts-agent/erp/erp-daemon.mjs --once` |
| Solo catálogo (pull) | `node scripts-agent/erp/sync-catalog.mjs` |
| Solo cola (push) | `node scripts-agent/erp/push-catalog.mjs --apply` |
| Solo pedidos | `node scripts-agent/erp/push-orders.mjs` (sin `DEMO-*`) |
| Conciliar facturas | `node scripts-agent/erp/reconcile.mjs --apply` |
| Reintentar errores | `UPDATE erp_outbox SET status='pending', attempts=0, last_error=NULL WHERE status='error';` |

### Windows: tarea programada

```bat
schtasks /Create /TN "Mercaldas ERP Sync" ^
  /TR "C:\Users\Desarrolo4\Documents\ecommerce\scripts-agent\erp\erp-sync.cmd" ^
  /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks /Run /TN "Mercaldas ERP Sync"
```

El `.cmd` reintenta cada 10 s si Node sale. Alternativa con NSSM: apuntar el
servicio a `erp-sync.cmd` (no a `dev.js --erp-sync`).

---

## 7. Mapa de escritura (resumen)

| Cambio en Postgres | Tabla ERP | Campos |
|---|---|---|
| `products.name` | `TIDSAL` | `INNOMBRE` (60) |
| atributo `nombre-corto` / `nombre-largo` | `TIDSAL` | `INNOMBRE3` (20) / `INNOMBRE4` (100) |
| `product_variants.barcode` | `TIDSAL` | `INEAN` (13) |
| `product_variants.*_mm` | `TIDSAL` | `INLARGO`/`INANCHO`/`INALTO` (cm = mm/10) |
| `brands` | `TIDMARCAS` + `TIDSAL` | `MCODIGO`/`MNOMBRE` + `INMARCAP` (no `INMARCA`) |
| `categories` / `product_categories` | `TIDTAB` | árbol `CTABCOD`/`CTABDES`/`CTABCOD1`; el nombre se actualiza por `CTABCOD` |
| `product_types` / asignación | `TIDTPRO` / `TIDSAL` | `CODIGO`/`NOMBRE`/`HABILITA`, `INTIPO` |
| atributo `categoria-erp` | — | espejo de lectura; no se escribe en `INCATE` |
| atributos `unidad-medida`, `presentacion`, etc. | `TIDSAL` | `INUNIDAD`, `INPRESEN`, `INEMBALAJE`, `INPARTE`, `ININVIMA`, `INCUM`, `INUBIC`, `INEAN14` |
| `product_variants.current_price` | `TIDSAL` | `INVRVENTA1`, `INVRVENTA0` |
| `inventory.stock` | `TIDSAL` | `INSALDO00` por `INSUC` |
| `products.is_active` / variante | `TIDSAL` | `INACTIVO` (`A`/`I`) |
| Pedido nuevo | `DOMDIA` / `DOMITE` | cabecera y líneas |
| Estado del pedido | `DOMDIA.FAESTADO` / `DOMITE.IFESTADO` | `0` pendiente, `5` cancelado, `9` facturado |

### Decisiones y límites

- **No se crean artículos nuevos** en `TIDSAL`: solo se actualizan los que ya
  existen por `INARTIC = product.external_id`. El alta de artículos es una
  decisión pendiente con el responsable del ERP.
- `INACTIVO='S'` (suspendido por el ERP) **no se pisa** desde el ecommerce.
- `INWEB`, `INAPP` y `SACATWEB` los gobierna el ERP; el ecommerce los lee al
  importar, pero no los escribe.
- `INCATE` **no se escribe**: en el ERP real está vacío en 34.659 filas y los
  códigos restantes no existen en `TIDTAB`. La categoría web vive en
  `categories`/`product_categories` y se deriva del prefijo del SKU.
- El árbol de categorías del ERP es **`TIDTAB`** (231 nodos, `CTABCOD` de 1 a 7
  dígitos, `CTABCOD1` = padre, `CTWEB`). `TIDCATE` es del modelo viejo y no se usa.
- `INMARCA` **no se escribe**: en el ERP real no coincide con `TIDMARCAS.MCODIGO`
  (ej. FRUCO tiene `INMARCA=2000145`, pero `TIDMARCAS` asigna ese código a AESSY
  OFF y `49` a FRUCO). Solo se actualiza `INMARCAP` (nombre).
- `INSUC` llega de asqlcmd como `1.000000000000000`; se normaliza a `1`, `2`, `11`
  antes de asociar precios/inventario a `branches.code`.
- `FAFCHFAC` e `IFFECHA` son enteros `YYYYMMDD`; los importes son `Double`.
  Enviar texto a esas columnas rompe el INSERT con `Invalid operand`.
- Los pedidos `DEMO-*` no se envían por defecto (`--include-demo` para probar).
- Las dimensiones se guardan en Postgres en **mm** y en el ERP en **cm**.
- Un `barcode` NULL/vacío en Postgres **no borra** `INEAN` del ERP: puede ser un
  EAN duplicado descartado durante la importación.
- El atributo `nombre-largo` (nombre de facturación) se sembró con el primer
  segmento de la descripción importada. Revísalo si la descripción se editó para
  la tienda; es el valor que se escribe en `INNOMBRE4`.
- El backlog inicial de 11.166 eventos `products` (activación masiva por
  imágenes) quedó en `skipped` para no desactivar el catálogo del ERP. Los
  cambios posteriores sí fluyen. Para reenviarlo:
  `UPDATE erp_outbox SET status='pending' WHERE kind='products' AND last_error LIKE 'backfill%';`
- `INCOSTO00` no se propaga: en la copia local está inflado y su semántica no
  está confirmada.

---

## 8. Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| `Error 5159` | falta `-CS "Data Source=...\PUBLIDATA.add"` en asqlcmd |
| `Invalid operand ... Target Data Type: <Integer>` | se envió texto a una fecha/campo numérico del ERP |
| `record not locked` | escritura vía OpenADS sobre la copia; usar asqlcmd contra el servicio ADS |
| El ERP no ve el cambio | el evento sigue `pending`/`error` en `erp_outbox`; correr `push-catalog --apply` y revisar `last_error` |
| El pull trae menos filas | parser CSV de asqlcmd (comillas internas sin escapar); ver `asqlcmd.mjs` |
| Sucursales duplicadas `1.000...` | `INSUC` numérico; usar `BRANCH_CODE()` |
| `INNOMBRE` truncado | límite real de la columna (`char(60)`), es esperado |
| La tienda no muestra imágenes | falta `db/images_static/` en el servidor |
| El pedido no aparece en `DOMDIA` | revisar `orders.erp_sync_status` y correr `push-orders --dry-run` |
| Bloqueos o archivos `.lck` en el ERP | no montes el directorio vivo en dos motores |

---

## 9. Pendientes con el responsable del ERP

1. Alta de artículos nuevos en `TIDSAL` (¿qué campos son obligatorios?).
2. `INMARCA`: ¿qué tabla referencia? No coincide con `TIDMARCAS.MCODIGO`.
3. Semántica de `INACTIVO='S'` e `INCOSTO00`.
4. Algoritmo real de `CODCLI` para clientes nuevos.
5. ¿Débito → `TD` o `TC`?
6. Confirmar si el ERP factura `DOMDIA`/`DOMITE` o `PEDDIA`/`PEDITE`.
7. Triggers en el ADS del ERP para avisar cambios en tiempo real (hoy el pull es
   cada 5 min).
