# Checklist — puesta en marcha contra el ERP real (en sitio)

Lista para validar cuando el ecommerce se conecte a la base Advantage del ERP.
Decisiones y evidencia: `docs/ESCRITURA-FORTUNER-READINESS.md`.
Comparación de esquema: `docs/COMPARACION-ESQUEMA-FORTUNER.md`.

## 0. Conexión

- [ ] `OPENADS_URL`, `OPENADS_USER`, `OPENADS_PASS` apuntan al OpenADS del ERP
      (o al motor Advantage equivalente).
- [ ] `DATABASE_URL` apunta a la Postgres del ecommerce.
- [ ] `node scripts-agent/erp/init-db.mjs` corre sin error (migraciones 19–24).
- [ ] `db/ads/fortuner-dicts/` tiene los `.ADT` (POSPAGO, TIDTIPOS, TIDBODE,
      TIDMARCAS, TIDTPRO) y `node scripts-agent/erp/sync-codes.mjs` corre sin error.
- [ ] Confirmar que el transporte admite **DML por SQL** (`/api/sql`: `UPDATE`/`DELETE`)
      y **insert**; si no, definir el mecanismo alterno.
- [ ] Tablas presentes: `tidsal`, `tidtab`, `tidcate`, `tidtpro`, `tidmarcas`,
      `tidbode`, `pospago`, `poscli`, `domdia`, `domite`, `faddia`, `fapago`.

## 1. Numeración y estados (códigos cerrados)

| Dato | Dónde se usa | Valor decidido | Evidencia |
|---|---|---|---|
| `FAPEDIDO` / `IFPEDIDO` | `push-orders.mjs` | 9 dígitos: `ERP_ORDER_PREFIX` (`9`) + id | `IFPEDIDO` es char(9); es el enlace cabecera-línea |
| `FAFACTURA` | `push-orders.mjs` | vacío al crear | la llena el ERP al facturar |
| `FAESTADO` | `push-orders.mjs` (`ERP_FAESTADO`) | `0` pendiente | pedidos demo 2026 sin factura |
| `IFESTADO` | `push-orders.mjs` (`ERP_IFESTADO`) | vacío = normal | 239.361 de 240.841 líneas facturadas (en disco se lee 32768) |
| `FATIPODOM` | `push-orders.mjs` (`ERP_TIPODOM`) | `01` domicilio | 42.391 de 52.585 filas |
| `IFTIPO` | `push-orders.mjs` (`ERP_IFTIPO`) | `E` venta | 143.713 líneas |
| `IFBODEGA` | `push-orders.mjs` (`ERP_BODEGA`) | `00` | `TIDSAL.INBODEGA='00'` en 51.938 filas |
| `FACANALV` | pendiente mapear | — | campo adicional |
| `FADOCPAGO` | pendiente mapear | — | campo adicional |
| `CLAWEB` / `NEWWEB` | pendiente mapear | — | campo adicional |

- [ ] Confirmar en sitio que el ERP lista para facturar un `DOMDIA` con
      `FAESTADO=0` y `FAPEDIDO` de 9 dígitos.

## 2. Estados de pedido → `DOMDIA.FAESTADO` / `DOMITE.IFESTADO`

Semilla corregida en `db/sql/24_erp_code_map_fortuner.sql` y `sync-codes.mjs`.

| `erp_value` | Significado | Estados ecommerce |
|---|---|---|
| `0` | Pendiente | `created`, `payment_pending`, `paid`, `preparing`, `ready`, `shipped` |
| `5` | Cancelado | `cancelled`, `refunded` |
| `9` | Facturado / entregado | `delivered` |

- [ ] Al cancelar, `push-catalog.mjs` actualiza también
      `DOMITE.IFESTADO=5 WHERE IFPEDIDO=<FAPEDIDO real>`.
- [ ] Confirmar que `32768` es el centinela nulo de `bin2` (línea normal = vacío).

## 3. Medios de pago ↔ `POSPAGO.CODIGO`

Mapa en `erp_code_map` (dominio `payment_method`), ya no hardcodeado:

| Ecommerce | ERP |
|---|---|
| `CASH` | `EF` EFECTIVO |
| `CARD` | `TC` TARJETA CREDITO |
| `PSE`, `BANK_TRANSFER`, `NEQUI`, `DAVIPLATA`, `BREB` | `TF` TRANSFERENCIA BANCARIA |

- [ ] Confirmar con caja si las tarjetas débito deben ir a `TD` en vez de `TC`
      (el ecommerce no distingue crédito/débito).
- [ ] Confirmar que las transferencias electrónicas comparten `TF`.

## 4. Cliente (`POSCLI`)

- [ ] Algoritmo real de `CODCLI`. Hoy `newErpCode(id, 13)` = `9` + secuencia.
- [ ] `SUCURSAL` por defecto del alta (`ERP_CUSTOMER_SUCURSAL`, hoy `01`).
- [ ] `TIPODOC` por defecto (`ERP_CUSTOMER_TIPODOC`, hoy `13`).
- [ ] Semántica de `FECHABAJA` (hoy no se usa).
- [ ] Confirmar que el ERP asigna/valida el `CODCLI` y no se generan duplicados.

## 5. Productos y maestras

- [ ] `TIDSAL` por sucursal: confirmar lista de precio (`INVRVENTA1`) y
      "antes" (`INVRVENTA0`).
- [ ] **Stock**: ¿se pisa `INSALDO00` o se envían **movimientos**? (hoy pisa).
- [ ] Alta de artículos nuevos desde el ecommerce: ¿se permite o el artículo nace
      en el ERP? (hoy sólo se **actualiza** por `external_id`).
- [ ] Marca: `INMARCA` **no se escribe** (en la copia no coincide con
      `TIDMARCAS.MCODIGO`: FRUCO tiene `INMARCA=2000145`, pero TIDMARCAS asigna
      ese código a AESSY OFF). El agente actualiza `TIDMARCAS` y `INMARCAP`
      (nombre). Confirmar qué tabla referencia realmente `INMARCA`.
- [ ] Tipos (`TIDTPRO`): confirmar convención `HABILITA`; `INTIPO` sale de
      `product_type_assignments` → `product_types.code`.
- [x] Categorías: confirmado que `TIDSAL.INCATE` referencia `TIDCATE` (códigos
      de 2/4/6 dígitos). El catálogo de Postgres se reconstruye desde ese árbol y
      cada producto guarda su código en el atributo `categoria-erp`.
- [x] Marcas: las marcas de Postgres salen de `TIDMARCAS` + los nombres
      referenciados en `TIDSAL.INMARCAP`; cada producto queda con su `brand_id`.
- [ ] Nombre corto/largo: el agente usa los atributos `nombre-corto` y
      `nombre-largo` (facturación), no la descripción de la tienda.
- [ ] Flags de visibilidad (`INWEB`, `SACATWEB`, `INAPP`): hoy los gobierna el ERP
      (sólo se leen al importar). `INACTIVO` sí se escribe desde `is_active`
      (`A`/`I`), respetando `S` (suspendido por el ERP).
- [ ] Dimensiones: `INALTO`/`INANCHO`/`INLARGO` en cm; el ecommerce las guarda en
      mm y el agente divide entre 10.

## 6. Conciliación (ERP → PG)

- [ ] Probar con una **factura real** del ERP que corresponda a un pedido web:
      `node scripts-agent/erp/reconcile.mjs --apply`.
- [ ] Confirmar el campo de enlace (`FADOMICIL` / `FACONTROL` / `FAPEDIDO`) y que
      `orders.status`/`erp_document_ref` queden correctos.

## 7. Operación continua

- [ ] Entrada pesada (catálogo + 146k clientes): programar `sync-all` cada tanto.
- [ ] Salida rápida: `node dev.js --erp-sync` (o cron/Task Scheduler con `sync-out --apply`).
- [ ] En Windows: registrar `dev.js --erp-sync` (y la BD) como servicio (NSSM/`sc.exe`).
- [ ] (Opcional, tiempo real) Triggers `DSI_EVENTO` en el ERP + agente + endpoints `/erp/*`.

## 8. Incidencias a vigilar

- [ ] Ping-pong de escritura (guardia `app.erp_sync='on'`).
- [ ] Diferencias de totales cabecera/línea en `DOMDIA`/`DOMITE`.
- [ ] Reintentos: `erp_outbox.status='error'` y `erp_dlq`.
