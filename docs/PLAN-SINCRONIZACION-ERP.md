# Plan de sincronización Ecommerce ⇄ ERP (camino a producción)

> **Estado**: borrador para ejecución.
> **Objetivo**: que el ecommerce y la base Advantage del ERP queden
> **coherentes y operativos**, de forma que podamos (a) **inyectar una venta** en
> el ERP, (b) **propagar cambios de producto/precio/stock** hechos en nuestro
> backend, y (c) **conectar fácil** cuando el aplicativo se monte donde vive el
> ERP.
> **Documentos relacionados**: `PLAN-INTEGRACION-ERP.md` (diseño y mapeo),
> `OPENADS-VALIDACION.md` (validación del piloto),
> `INTEGRACION-ERP-ADVANTAGE.md` (descubrimiento de la copia).
> **Última actualización**: 2026-10-09.

---

## 1. Objetivo operativo (lo que buscamos)

| Capacidad | Descripción |
|---|---|
| **Venta** | Un pedido web se registra en el ERP (`DOMDIA`/`DOMITE`) para que el ERP lo facture. |
| **Producto** | Un cambio hecho en nuestro backend (precio, stock, alta) se refleja en el ERP. |
| **Coherencia** | Los datos compartidos (catálogo, precios, stock, clientes, facturación) coinciden en ambos lados. |
| **Despliegue** | Al montar el aplicativo junto al ERP, basta cambiar la URL/credenciales. |

---

## 2. Qué usa **realmente** el ecommerce (y qué no)

Regla: **sólo se sincroniza lo que el aplicativo consume**. Verificado en el
código (módulos `catalog`, `inventory`, `orders`, `customers`, `delivery`).

| Dato del ERP | Destino Postgres | ¿Se usa? | Decisión |
|---|---|---|---|
| `TIDSAL` (artículos, precio, saldo) | `products`, `product_variants`, `prices`, `inventory`, `branch_products` | **Sí** | **Sincronizar** (hecho) |
| `TIDTAB`/`TIDCATE` (categorías) | `categories`, `product_categories` | Sí | Sincronizar (hecho) |
| `TIDTPRO` (tipos) | `product_types` | Sí | Sincronizar (hecho) |
| `TIDMARCAS`/`INMARCAP` (marcas) | `brands` | Sí | Sincronizar (hecho) |
| `POSCLI` (clientes) | `customers` | Sí (¿?) | Sincronizar (hecho) |
| `FADDIA`/`FAPAGO` (facturación) | `erp_invoices`/`erp_payments` | **No** (0 referencias en el backend) | **Podar**: sólo la porción enlazada a *nuestros* pedidos (conciliación) |
| `FADCLI` (clientes de facturación) | — | No | **No traer** |
| `TIDTIPOS` (56 clases de impuesto) | `tax_rates` | No (el carrito usa 3 tarifas) | **No traer** |
| `INVRVENTA2..10` (otras listas de precio) | — | No (usa la lista 1 + "antes") | **No traer** |
| `POSMENU`/`POSARCA`/`POSCAJA`/`POSDCTO*`/`PUBLIDATA`/`NOMCALEN`… | — | No | **No traer** |
| `FADITE` (5,7 GB, detalle de línea) | — | No (sólo para verificación puntual) | **No traer** |

> **Conclusión**: la sincronización útil se limita al **catálogo + precios +
> stock**, **clientes**, y la **conciliación de facturas de nuestros pedidos**.
> Todo lo demás es ruido para el ecommerce.

---

## 3. Estado actual (lo que ya está)

| Sentido | Entidad | Script / artefacto | Estado |
|---|---|---|---|
| ERP → PG | Diccionario de códigos | `sync-codes.mjs` | ✅ (6 dominios) |
| ERP → PG | Catálogo | `sync-catalog.mjs` | ✅ |
| ERP → PG | Clientes | `sync-customers.mjs` | ✅ |
| ERP → PG | Facturación (espejo completo) | `sync-invoices.mjs` | ⚠️ opcional/gated (`--full`); no lo usa el ecommerce |
| PG → ERP | Pedidos | `push-orders.mjs` | ✅ |
| PG → ERP | Clientes | `push-customers.mjs` | ✅ (`CODCLI` provisional) |
| PG → ERP | Precio / stock | `push-catalog.mjs` + triggers (`db/sql/21_erp_catalog_outbox.sql`) | ✅ |
| ERP ⇄ PG | Conciliación factura→pedido | `reconcile.mjs` | ✅ |
| — | Runner / automatización | `sync-all.mjs` | ✅ (cron/Task Scheduler) |
| Backend | Módulo/endpoints ERP | — | ❌ no existe (todo por scripts) |
| Tiempo real | Triggers `DSI_EVENTO` + endpoints `/erp/*` | — | ❌ pendiente |

Despliegue: `docs/RUNBOOK-ERP.md`.

---

## 4. Lo que falta para lograrlo

### 4.A Inyectar una venta (PG → ERP)
- ✅ Pedido → `DOMDIA`/`DOMITE`.
- ❌ **Alta de cliente PG → `POSCLI`** (el ERP asigna `CODCLI`; hoy no sube).
- ❌ **Drenado de `erp_outbox`** como servicio/loop (hoy `push-orders` lee `orders` directo).
- ❌ Numeración y estados: `FAPEDIDO`, `FAESTADO`/`IFESTADO`, `FATIPODOM`.
- ❌ **Retorno**: el ERP factura → actualizar estado/factura de *nuestro* pedido (conciliación `FADOMICIL` → `orders`).

### 4.B Modificar producto desde el backend → ERP
- Hoy `catalog.service.createProduct/updateProduct` y `inventory` escriben **sólo en Postgres**.
- Hace falta: **regla de propiedad por campo** (quién manda), `erp_outbox` de catálogo
  (`kind='product'|'price'|'stock'`), writers a `TIDSAL`/`TIDMARCAS`/`TIDCATE`/`TIDTPRO`
  y **resolución de conflictos** (marca de tiempo/hash).
- Ojo: `TIDSAL` es por sucursal y tiene campos derivados → escribir con cuidado;
  el **stock** conviene por **movimientos**, no pisando `INSALDO00`.

### 4.C Conexión y despliegue en el sitio del ERP
- ✅ URL/credenciales parametrizadas (`OPENADS_URL`/`OPENADS_USER`/`OPENADS_PASS`).
- ❌ Definir **quién ejecuta los syncs**: agente en Windows junto al ERP (OpenADS REST, ya probado) vs. el backend.
- ❌ Agente como **servicio** (reconexión, healthcheck, logging).
- ❌ Provisionar la copia del ERP (`db/ADD_ANALITICA` no va en git).

### 4.D Automatización
- ❌ **Mínimo**: un scheduler/cron que corra los syncs y el drenado del outbox.
- ❌ **Tiempo real**: triggers `DSI_EVENTO` en el ERP + agente + endpoints `/erp/*` en el backend.

### 4.E Decisiones de negocio (bloquean el mapeo fino)
- §11 de `PLAN-INTEGRACION-ERP.md`: `FAPEDIDO`, `FAESTADO`/`IFESTADO`, `FATIPODOM`,
  `FACANALV`, `FADOCPAGO`, `CLAWEB`/`NEWWEB`, `FECHABAJA`.
- Medios de pago `NEQUI`/`DAVIPLATA`/`PSE` ↔ `POSPAGO`.
- `erp_code_map`: faltan dominios (tipo factura, estado pedido/línea, tipo domicilio, tipo doc).

---

## 5. Fases

### Fase A — Podar y fijar el alcance  ✅ *implementada*

- Documentar qué se sincroniza y qué **no** (§2).
- Sacar el espejo completo de facturación del set "requerido" (queda opcional/analítica).
- **Aceptación**: un único lugar (`scripts-agent/erp/README.md`) lista los syncs
  requeridos; ningún sync trae datos que el ecommerce no use.

### Fase B — Cerrar el ciclo de venta  ✅ *implementada (enums pendientes del ERP)*

- Alta/actualización de cliente PG → `POSCLI` (`push-customers.mjs`).
- Drenado de `erp_outbox` / salida de pedidos (`push-orders.mjs`).
- Conciliación factura → pedido (`FADOMICIL` → `orders`) + estados (`reconcile.mjs`).
- Cerrar enums (§4.E) — **pendiente de confirmar con el ERP**.
- **Aceptación**: un pedido web real termina registrado en el ERP, con cliente
  creado, y al facturarse el ERP el estado del pedido en PG se actualiza.

### Fase C — Escritura de producto/precio/stock PG → ERP  ✅ *implementada (prototipo)*

- Matriz de propiedad por campo + outbox de catálogo + writers + resolución de conflictos.
- Implementado: triggers `21_erp_catalog_outbox.sql` + `push-catalog.mjs`
  (precio lista 1 global; stock por sucursal pisando `INSALDO00` — provisional).
- **Aceptación**: editar el precio (o el stock) de un producto en el backend se
  refleja en el ERP (y el diff inverso no lo revierte por el guardia `app.erp_sync`).

### Fase D — Automatización y despliegue  ✅ *implementada (agente/servicio pendiente)*

- Runner `sync-all.mjs` (modo seguro / `--apply`).
- Runbook: `docs/RUNBOOK-ERP.md` (env, cron/Task Scheduler, troubleshooting).
- **Aceptación**: en la máquina del ERP, `dev.js` + scheduler dejan el sistema
  sincronizado sin intervención manual, sólo cambiando la URL/credenciales.

**Orden recomendado**: A → B → D(scheduler) → C.

---

## 6. Riesgos

- **Doble dueño del catálogo**: si el ERP y el backend escriben `TIDSAL`, puede
  haber "ping-pong". Mitigar con marca de tiempo/origen y campos de propiedad clara.
- **Numeración / DIAN**: una mala coordinación de `FAPEDIDO`/`FAFACTURA` descuadra.
- **Volumen**: `FADITE` (5,7 GB) no puede volcarse entero.
- **Enums sin descifrar**: bloquean el mapeo de estados.
