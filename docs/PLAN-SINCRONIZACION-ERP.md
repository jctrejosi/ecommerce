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
| `TIDCATE` (categorías) | `categories`, `product_categories` | Sí | Sincronizar (hecho) |
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
| ERP → PG | Diccionario de códigos | `sync-codes.mjs` | ✅ (marcas, tipos, bodegas, pagos, impuestos, `order_status`; `city` sin fuente) |
| ERP → PG | Catálogo | `sync-catalog.mjs` | ✅ |
| ERP → PG | Clientes | `sync-customers.mjs` | ✅ |
| ERP → PG | Facturación (espejo completo) | `sync-invoices.mjs` | ⚠️ opcional/gated (`--full`); no lo usa el ecommerce |
| PG → ERP | Pedidos | `push-orders.mjs` | ✅ |
| PG → ERP | Clientes (alta + actualización) | `push-customers.mjs` | ✅ (`CODCLI` generado, 13 chars) |
| PG → ERP | Precio / stock | `push-catalog.mjs` + triggers (`db/sql/21_erp_catalog_outbox.sql`) | ✅ |
| PG → ERP | Maestras: marcas, categorías, tipos, producto | `push-catalog.mjs` + triggers (`db/sql/22_erp_outbox_masters.sql`) | ✅ |
| PG → ERP | Estado de pedido (`DOMDIA.FAESTADO`) | `push-catalog.mjs` + trigger (`22`) + `erp_code_map` | ✅ (códigos cerrados con FORTUNER) |
| ERP ⇄ PG | Conciliación factura→pedido | `reconcile.mjs` | ✅ |
| PG → ERP | Drenado de salida (loop/cron) | `sync-out.mjs` | ✅ |
| — | Runner / automatización | `sync-all.mjs` | ✅ (cron/Task Scheduler) |
| — | Arranque con el launcher | `dev.js --erp-sync` | ✅ (deja la salida en bucle) |
| Backend | Módulo/endpoints ERP | — | ❌ no existe (todo por scripts) |
| Tiempo real | Triggers `DSI_EVENTO` + endpoints `/erp/*` | — | ❌ pendiente |

Despliegue: `docs/RUNBOOK-ERP.md`.

---

## 4. Lo que falta para lograrlo

### 4.A Inyectar una venta (PG → ERP)
- ✅ Pedido → `DOMDIA`/`DOMITE` (`push-orders.mjs`).
- ✅ **Alta/actualización de cliente PG → `POSCLI`** (`push-customers.mjs`; `CODCLI` generado de 13 chars).
- ✅ **Drenado de `erp_outbox`** como loop (`sync-out.mjs --loop=N`).
- ✅ Numeración y estados cerrados con FORTUNER: `FAPEDIDO`/`IFPEDIDO` 9 dígitos, `FAESTADO` 0/5/9, `IFESTADO` vacío (normal)/5, `FATIPODOM` 01 (ver `docs/ESCRITURA-FORTUNER-READINESS.md`).
- ✅ **Retorno**: el ERP factura → actualizar estado/factura de *nuestro* pedido (`reconcile.mjs`).

### 4.B Modificar producto desde el backend → ERP
- ✅ Tras editar en el backend, el trigger encola en `erp_outbox` y `push-catalog.mjs`
  escribe en `TIDSAL`/`TIDMARCAS`/`TIDCATE`/`TIDTPRO` (precio, stock, marca,
  categoría, tipo, nombre de producto). Ver `db/sql/22_erp_outbox_masters.sql`.
- ⚠️ Regla de propiedad: el ERP es dueño del catálogo; nuestro push lo pisa
  (decisión aceptada). Guardia `app.erp_sync='on'` evita el ping-pong.
- Ojo: `TIDSAL` es por sucursal; el **stock** conviene por **movimientos**, no
  pisando `INSALDO00` (hoy provisional).

### 4.C Conexión y despliegue en el sitio del ERP
- ✅ URL/credenciales parametrizadas (`OPENADS_URL`/`OPENADS_USER`/`OPENADS_PASS`).
- ❌ Definir **quién ejecuta los syncs**: agente en Windows junto al ERP (OpenADS REST, ya probado) vs. el backend.
- ❌ Agente como **servicio** (reconexión, healthcheck, logging).
- ❌ Provisionar la copia del ERP (`db/ADD_ANALITICA` no va en git).

### 4.D Automatización
- ✅ **Salida continua**: `node dev.js --erp-sync` deja `sync-out --apply` en bucle
  (o cron/Task Scheduler con `sync-out --apply`).
- ✅ **Entrada**: `sync-all.mjs` para el volcado pesado (catálogo + 146k clientes).
- ❌ **Tiempo real**: triggers `DSI_EVENTO` en el ERP + agente + endpoints `/erp/*` en el backend.

### 4.F Valores a confirmar en sitio
- Checklist completo: `docs/CHECKLIST-ERP-SITIO.md` (enums, numeración, `CODCLI`,
  medios de pago, stock como movimientos, alta de artículos, conciliación real).

### 4.E Decisiones de negocio (bloquean el mapeo fino)
- §11 de `PLAN-INTEGRACION-ERP.md`: `FAPEDIDO`, `FAESTADO`/`IFESTADO`, `FATIPODOM`,
  `FACANALV`, `FADOCPAGO`, `CLAWEB`/`NEWWEB`, `FECHABAJA`.
- Medios de pago `NEQUI`/`DAVIPLATA`/`PSE` ↔ `POSPAGO`.
- `erp_code_map`: dominios poblados desde `POSPAGO`, `TIDTIPOS`, `TIDBODE`,
  `TIDMARCAS` y `TIDTPRO` con `sync-codes.mjs`; la semilla de `order_status`
  quedó en `db/sql/24_erp_code_map_fortuner.sql` y usa códigos reales.

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

### Fase C — Escritura de producto/precio/stock PG → ERP  ✅ *implementada*

- Matriz de propiedad por campo + outbox de catálogo + writers.
- Implementado: triggers `21_erp_catalog_outbox.sql` (precio/stock) y
  `22_erp_outbox_masters.sql` (marcas, categorías, tipos, producto, estado de
  pedido) + `push-catalog.mjs` (drena `erp_outbox`).
- **Aceptación**: editar precio/stock/marca/categoría/tipo/nombre/estado en el
  backend se refleja en el ERP (y el diff inverso no lo revierte por el guardia
  `app.erp_sync`).

### Fase D — Automatización y despliegue  ✅ *implementada (agente/servicio pendiente)*

- Runner `sync-all.mjs` (modo seguro / `--apply`).
- Arranque de la salida continua con el launcher: `dev.js --erp-sync`.
- Runbook: `docs/RUNBOOK-ERP.md` (env, cron/Task Scheduler, troubleshooting).
- Checklist de sitio: `docs/CHECKLIST-ERP-SITIO.md`.
- **Aceptación**: en la máquina del ERP, `dev.js --erp-sync` + scheduler dejan el
  sistema sincronizado sin intervención manual, sólo cambiando la URL/credenciales.

**Orden recomendado**: A → B → D(scheduler) → C.

---

## 6. Riesgos

- **Doble dueño del catálogo**: si el ERP y el backend escriben `TIDSAL`, puede
  haber "ping-pong". Mitigar con marca de tiempo/origen y campos de propiedad clara.
- **Numeración / DIAN**: una mala coordinación de `FAPEDIDO`/`FAFACTURA` descuadra.
- **Volumen**: `FADITE` (5,7 GB) no puede volcarse entero.
- **Enums sin descifrar**: bloquean el mapeo de estados.
