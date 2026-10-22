# Despliegue — ecommerce junto a FORTUNER (ERP Advantage)

Guía para instalar el ecommerce en el servidor Windows donde vive el ERP y
dejar **cada transacción apuntando a las tablas reales de `C:\ADD_FORTUNER`**.

- Diseño de la integración: `docs/PLAN-INTEGRACION-ERP.md`
- Campos y códigos cerrados: `docs/ESCRITURA-FORTUNER-READINESS.md`
- Operación diaria y problemas: `docs/RUNBOOK-ERP.md`
- Checklist en sitio: `docs/CHECKLIST-ERP-SITIO.md`

---

## 1. Arquitectura

```mermaid
graph TD
    A["Cliente / Admin / Bot"] --> B["Backend NestJS :3000"]
    B --> C[(PostgreSQL ecommerce :5432)]
    C --> D["Agente sync-out (cada 30 s)"]
    D --> E["OpenADS HTTP :18080"]
    E --> F[("Tablas Advantage C:\ADD_FORTUNER")]
    F --> E
    E --> D
    D --> C
```

Flujo de una compra:

1. El cliente crea el pedido en el backend → `orders` + `order_items` en Postgres.
2. `sync-out` ejecuta `push-orders`: inserta cabecera en `DOMDIA` y líneas en `DOMITE`.
3. El ERP factura el pedido y actualiza `FAESTADO`/`FAFACTURA`.
4. `reconcile` lee esos cambios y actualiza `orders`/`invoices` en Postgres.

Flujo de una edición de producto en el admin:

1. El admin actualiza `products`, `product_variants`, `product_type_assignments`
   o `product_categories`.
2. Un trigger encola el cambio en `erp_outbox` (`kind='products'` o
   `'product_flags'`).
3. `push-catalog` lee el producto completo desde Postgres y actualiza `TIDSAL`
   (nombre, barcode, marca, tipo, categoría, dimensiones, estado).

---

## 2. Requisitos en el servidor

| Componente | Requisito |
|---|---|
| SO | Windows 10/11 o Windows Server 2019+ |
| Node.js | 20 o superior (`node --version`) |
| Docker | Docker Desktop con WSL2 (para PostgreSQL y, opcionalmente, OpenADS) |
| Git | Para clonar/actualizar el proyecto |
| ERP | Acceso de lectura/escritura a `C:\ADD_FORTUNER` |
| Puertos | `5432` (Postgres), `3000` (API), `4173` (tienda), `8443` (admin), `18080` y `16262` (OpenADS) |

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

# OpenADS (puente HTTP hacia Advantage)
OPENADS_URL=http://localhost:18080
OPENADS_USER=dsi
OPENADS_PASS=dsi

# --- Opción A: OpenADS ya sirve el ERP en esta máquina (recomendada) ---
ERP_ADV_EXTERNAL=1

# --- Opción B: Docker monta la carpeta del ERP ---
# ERP_ADV_DATA=C:/ADD_FORTUNER
# ERP_ADV_WIRE_PORT=16262
# ERP_ADV_HTTP_PORT=18080
# ERP_ADV_USER=dsi
# ERP_ADV_PASS=dsi
# ERP_ADV_HTTP_USER=dsi
# ERP_ADV_HTTP_PASS=dsi

# Numeración y códigos del ERP (valores cerrados con FORTUNER)
ERP_ORDER_PREFIX=9
ERP_FAESTADO=0
ERP_TIPODOM=01
ERP_BODEGA=00
ERP_IFTIPO=E

# Frecuencia del agente de salida
ERP_SYNC_INTERVAL=30
```

Notas:

- `dev.js` carga `backend/.env.production` y `backend/.env` (con
  `NODE_ENV=production`) **antes** de arrancar los servicios; no hace falta
  exportar cada variable en la consola. `NODE_ENV` sí debe estar en el entorno
  del proceso (servicio o terminal).
- En Windows usa **barras normales** (`C:/ADD_FORTUNER`) o duplica las barras
  invertidas (`C:\\ADD_FORTUNER`). Una sola `\` puede escaparse.
- `ERP_ADV_EXTERNAL=1` evita que `dev.js` levante otro contenedor OpenADS. En
  ese modo el OpenADS debe estar corriendo como servicio aparte; `dev.js` sólo
  verifica `OPENADS_URL/api/health`.
- Si cambias `ERP_ADV_DATA` y ya existe el contenedor `openads-img`, bórralo para
  que se recree con el nuevo montaje: `docker rm -f openads-img`.
- No montes `C:\ADD_FORTUNER` en Docker si el ERP lo tiene abierto con su propio
  motor ADS: usa una copia o el OpenADS que ya sirve el ERP.
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
node scripts-agent/erp/sync-categories.mjs --apply   :: TIDCATE + TIDMARCAS
node scripts-agent/erp/remap-shelves.mjs --apply     :: estanterías → TIDCATE
```

- `sync-categories.mjs` es **idempotente**: crea/actualiza el árbol de
  `TIDCATE` (códigos de 2/4/6 dígitos), crea las marcas de `TIDMARCAS` y las que
  sólo aparecen en `TIDSAL.INMARCAP`, y reasigna `product_categories` y
  `products.brand_id` de todos los artículos. Las categorías viejas que quedan
  sin productos ni referencias se ocultan.
- `remap-shelves.mjs` traduce `shelf_categories` de las categorías viejas a las
  hojas `TIDCATE` equivalentes. Va en dry-run por defecto; revisa el resumen
  antes de `--apply`. Las estanterías de farmacia, ferretería, juguetería y
  servicios no tienen rama en `TIDCATE` y quedan sin categorías.

En régimen normal no hace falta repetirlos: `sync-catalog.mjs` (paso de
`sync-all`) ya lee `TIDCATE` y `TIDMARCAS` en cada pasada y mantiene categorías,
marcas y asignaciones al día. Es una entrada **pesada** (~21k artículos de
`TIDSAL`), así que prográmala aparte (cron cada N minutos/horas); el bucle de
`sync-out` sólo empuja PG → ERP.

> `db/ads/fortuner-dicts/` debe viajar con el proyecto. Si falta, `sync-codes`
> no puede mapear marcas/tipos/pagos.

### 4.4 Arrancar

```bat
set NODE_ENV=production
node dev.js --prod --erp-sync
```

PowerShell:

```powershell
$env:NODE_ENV="production"
node dev.js --prod --erp-sync
```

Esto levanta PostgreSQL, OpenADS (o valida el externo), backend, tienda, admin,
bot y el agente `sync-out` cada 30 s. Logs en `logs/`.

Para validar sólo la integración con Advantage (sin webs ni backend):

```bat
node dev.js --advantage
```

Levanta PostgreSQL + OpenADS y deja `sync-out` en bucle. Comprueba que
`http://localhost:18080` responde y que `logs/erp-sync.log` no tiene errores.
Se detiene con `Ctrl+C` y `node dev.js --stop`.

Para detener:

```bat
node dev.js --stop
```

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

   `INMARCA` debe conservar el valor que tenía el ERP; el agente no lo escribe.

### 5.2 Compra → `DOMDIA` / `DOMITE`

1. Haz una compra desde la tienda (o crea el pedido por API).
2. Fuerza el envío:

   ```bat
   node scripts-agent/erp/push-orders.mjs --dry-run
   node scripts-agent/erp/push-orders.mjs
   ```

3. En el ERP:

   ```sql
   SELECT FAPEDIDO, FACONTROL, FAFECHA, FATOTAL, FAESTADO
     FROM DOMDIA WHERE FACONTROL = '<reference_code>';

   SELECT IFPEDIDO, IFARTIC, IFCANT, IFPRECIO, IFESTADO
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
| Salida en bucle | `node scripts-agent/erp/sync-out.mjs --apply --loop=30` |
| Un ciclo | `node scripts-agent/erp/sync-out.mjs --apply` |
| Solo catálogo | `node scripts-agent/erp/push-catalog.mjs --apply` |
| Solo pedidos | `node scripts-agent/erp/push-orders.mjs` |
| Conciliar facturas | `node scripts-agent/erp/reconcile.mjs --apply` |
| Reintentar errores | `UPDATE erp_outbox SET status='pending', attempts=0, last_error=NULL WHERE status='error';` |

### Windows como servicio

Con [NSSM](https://nssm.cc/):

```bat
nssm install MercaldasEcommerce "C:\Program Files\nodejs\node.exe" "C:\mercaldas\ecommerce\dev.js" --prod --erp-sync
nssm set MercaldasEcommerce AppDirectory "C:\mercaldas\ecommerce"
nssm set MercaldasEcommerce AppEnvironmentExtra NODE_ENV=production
nssm start MercaldasEcommerce
```

O con el Programador de tareas, ejecutando el mismo comando al iniciar sesión.
Verifica que `node` esté en el `PATH` del usuario del servicio.

---

## 7. Mapa de escritura (resumen)

| Cambio en Postgres | Tabla ERP | Campos |
|---|---|---|
| `products.name` | `TIDSAL` | `INNOMBRE` (60) |
| atributo `nombre-corto` / `nombre-largo` | `TIDSAL` | `INNOMBRE3` (20) / `INNOMBRE4` (100) |
| `product_variants.barcode` | `TIDSAL` | `INEAN` (13) |
| `product_variants.*_mm` | `TIDSAL` | `INLARGO`/`INANCHO`/`INALTO` (cm = mm/10) |
| `brands` | `TIDMARCAS` + `TIDSAL` | `MCODIGO`/`MNOMBRE` + `INMARCAP` (no `INMARCA`) |
| `categories` / `product_categories` | `TIDCATE` + `TIDSAL` | árbol `CTABCOD`/`CTABDES`; `TIDSAL.INCATE` → atributo `categoria-erp` |
| `product_types` / asignación | `TIDTPRO` / `TIDSAL` | `CODIGO`/`NOMBRE`/`HABILITA`, `INTIPO` |
| atributo `categoria-erp` | `TIDSAL` | `INCATE` |
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
- `INCATE` es la categoría del ERP (`TIDCATE`), no el árbol web viejo. Se
  importa a `categories`/`product_categories` y se conserva en el atributo
  `categoria-erp`; al escribir un producto se envía ese atributo a `INCATE`.
- `TIDCATE` sólo cubre supermercado (electrodomésticos, carnes, fruver,
  despensa, lácteos, licores, bebé, mascotas y limpieza). Farmacia, ferretería,
  juguetería, papelería y servicios no tienen categoría ERP equivalente.
- `INMARCA` **no se escribe**: en la copia no coincide con `TIDMARCAS.MCODIGO`
  (ej. FRUCO tiene `INMARCA=2000145`, pero `TIDMARCAS` asigna ese código a
  AESSY OFF y `49` a FRUCO). Solo se actualiza `INMARCAP` (nombre).
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
| `ECONNREFUSED :18080` | OpenADS caído o `OPENADS_URL` incorrecta |
| `ERP ... authentication required` | revisar `OPENADS_USER/PASS` y `ERP_ADV_HTTP_USER/PASS` |
| `could not find ... .dbf` | la ruta `--data` no contiene las tablas (`ERP_ADV_DATA`) |
| El ERP no ve el cambio | el evento sigue `pending`/`error` en `erp_outbox`; correr `push-catalog --apply` y revisar `last_error` |
| `INNOMBRE` truncado | límite real de la columna (`char(60)`), es esperado |
| La tienda no muestra imágenes | falta `db/images_static/` en el servidor |
| El pedido no aparece en `DOMDIA` | revisar `orders.erp_sync_status` y correr `push-orders --dry-run` |
| Bloqueos o archivos `.lck` en el ERP | no montes el directorio vivo en dos motores; usa una copia o el OpenADS que ya sirve el ERP |

---

## 9. Pendientes con el responsable del ERP

1. Alta de artículos nuevos en `TIDSAL` (¿qué campos son obligatorios?).
2. `INCATE`: ¿qué tabla lo alimenta? Los valores locales son de 6 dígitos
   (`050703`) y no salen del árbol web; hoy se conserva `categoria-erp`.
3. `INMARCA`: ¿qué tabla referencia? No coincide con `TIDMARCAS.MCODIGO`.
4. Semántica de `INACTIVO='S'` e `INCOSTO00`.
5. Algoritmo real de `CODCLI` para clientes nuevos.
6. ¿Débito → `TD` o `TC`?
7. Confirmar si el ERP factura `DOMDIA`/`DOMITE` o `PEDDIA`/`PEDITE`.
