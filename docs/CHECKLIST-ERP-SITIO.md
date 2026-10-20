# Checklist — puesta en marcha contra el ERP real (en sitio)

Lista para llenar cuando se conecte el ecommerce a la base Advantage del ERP.
Diseño: `docs/PLAN-SINCRONIZACION-ERP.md`. Operación: `docs/RUNBOOK-ERP.md`.

## 0. Conexión

- [ ] `OPENADS_URL`, `OPENADS_USER`, `OPENADS_PASS` apuntan al OpenADS del ERP
      (o al motor Advantage equivalente).
- [ ] `DATABASE_URL` apunta a la Postgres del ecommerce.
- [ ] `node scripts-agent/erp/init-db.mjs` corre sin error (migraciones 19–23).
- [ ] Confirmar que el transporte admite **DML por SQL** (`/api/sql`: `UPDATE`/`DELETE`)
      y **insert**; si no, definir el mecanismo alterno.
- [ ] Tablas presentes: `tidsal`, `tidtab`, `tidcate`, `tidtpro`, `tidmarcas`,
      `tidbode`, `pospago`, `posdane`, `poscli`, `domdia`, `domite`,
      `faddia`, `fapago`.

## 1. Numeración y estados (bloquea la inyección de ventas)

| Dato | Dónde se usa | Valor en la copia (piloto) | Valor real del ERP |
|---|---|---|---|
| `FAPEDIDO` (numeración) | `push-orders.mjs` | `String(id).padStart(9,'0')` | |
| `FAESTADO` (cabecera) | `push-orders.mjs` (`ERP_FAESTADO`) | `0` | |
| `IFESTADO` (línea) | `push-orders.mjs` (`ERP_IFESTADO`) | `0` | |
| `FATIPODOM` | `push-orders.mjs` (`ERP_TIPODOM`) | `01` | |
| `IFTIPO` | `push-orders.mjs` (`ERP_IFTIPO`) | `E` (venta) | |
| `FACANALV` | pendiente mapear | — | |
| `FADOCPAGO` | pendiente mapear | — | |
| `CLAWEB` / `NEWWEB` | pendiente mapear | — | |

- [ ] Confirmar cada valor y, si aplica, dejarlo en `backend/.env.development.local`.

## 2. Estados de pedido → `DOMDIA.FAESTADO` (`order_status`)

Semilla **provisional** en `db/sql/23_erp_order_status_map.sql`. En la copia:

| `erp_value` | Observado | Semilla (canonical) |
|---|---|---|
| `9` | 50.758 filas (casi todas con `FAPEDIDO`) | `delivered` |
| `5` | 389 filas (algunas con `FAPEDIDO`) | `preparing`, `ready`, `shipped` |
| `0` | 134 filas (sin `FAPEDIDO`) | `cancelled`, `refunded` |
| `` | 1.303 filas | (sin uso) |

- [ ] Confirmar el significado real de `9` / `5` / `0`.
- [ ] Ajustar con `UPDATE erp_code_map SET erp_value='…' WHERE domain='order_status' AND canonical='…'`
      (no requiere tocar código).

## 3. Medios de pago ↔ `POSPAGO.CODIGO`

Hoy `PAY_MAP` fijo en `push-orders.mjs`: `CASH→EF`, `CARD→TC`, `PSE/NEQUI/DAVIPLATA→TF`.

- [ ] Confirmar códigos reales de `POSPAGO` para `CASH`, `CARD`, `PSE`, `NEQUI`, `DAVIPLATA`.
- [ ] Decidir si `PSE`/`NEQUI`/`DAVIPLATA` comparten código o son distintos.

## 4. Cliente (`POSCLI`)

- [ ] Algoritmo real de `CODCLI` (hoy `ERP_NEW_CODE_PREFIX` + id, `2999########`).
- [ ] `SUCURSAL` por defecto del alta (`ERP_CUSTOMER_SUCURSAL`, hoy `01`).
- [ ] `TIPODOC` por defecto (`ERP_CUSTOMER_TIPODOC`, hoy `13`).
- [ ] Semántica de `FECHABAJA` (hoy no se usa).
- [ ] Confirmar que el ERP asigna/valida el `CODCLI` y no se generan duplicados.

## 5. Productos y maestras

- [ ] `TIDSAL` por sucursal: confirmar lista de precio usada (`INVRVENTA1`) y "antes" (`INVRVENTA0`).
- [ ] **Stock**: ¿se pisa `INSALDO00` o se envían **movimientos**? (hoy pisa).
- [ ] Alta de artículos nuevos desde el ecommerce: ¿se permite o el artículo nace en el ERP?
      (hoy sólo se **actualiza** por `external_id`).
- [ ] Marca: `INMARCAP` (nombre) vs `INMARCA` (código) — cuál es la relación real
      artículo↔marca; ¿sincronizar el renombrado a las filas de `TIDSAL`?
- [ ] Tipos (`TIDTPRO`): confirmar convención `HABILITA` (`T`=activo, `F`, `''`).
- [ ] Categorías (`TIDTAB`): confirmar árbol y si el ecommerce puede crear códigos.
- [ ] Flags de visibilidad/estado (`INACTIVO` `A/I/S`, `INWEB`, `SACATWEB`, `INAPP`):
      ¿se propagan o los gobierna el ERP?

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
