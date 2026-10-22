# ¿Estamos listos para escribir en FORTUNER?

> Basado en el esquema real de `C:\ADD_FORTUNER` (dsi-vps), en las
> tablas-diccionario copiadas a `db/ads/fortuner-dicts/` y en los datos reales de
> la copia de trabajo (`db/ads/openads/data/`). Comparación de esquema:
> `docs/COMPARACION-ESQUEMA-FORTUNER.md`.

## Veredicto corto

- **Estructuralmente sí**: las 17 tablas de la integración existen en FORTUNER y
  los 70 campos que escribimos existen con el tipo esperado.
- **Códigos cerrados**: numeración, estados, tipo de domicilio, pagos, impuestos,
  enlace de líneas, bodega y envío ya tienen un valor decidido con evidencia de
  producción. No quedan códigos “provisionales”.
- **Pendiente de negocio**: confirmar si las categorías nuevas van a `TIDTAB` o
  `TIDCATE`; si el ERP factura desde `DOM*` o `PED*`; y el alta de artículos
  nuevos (hoy sólo hay UPDATE de `TIDSAL`).
- **Para piloto controlado sí**: se puede escribir en una copia de trabajo de
  FORTUNER (nunca en producción) y validar la facturación.

## Fuentes usadas

| Fuente | Uso |
|---|---|
| `db/ads/fortuner-dicts/POSPAGO.ADT` | 129 filas, 45 códigos de pago; `VALIDAWEB`/`PERMIDSI` |
| `db/ads/fortuner-dicts/TIDTIPOS.ADT` | 56 clases; sólo `CLASE='IM'` son impuestos (13) |
| `db/ads/fortuner-dicts/TIDBODE.adt` | 29 bodegas |
| `db/ads/fortuner-dicts/TIDMARCAS.adt` | 2.176 marcas |
| `db/ads/fortuner-dicts/TIDTPRO.ADT` | 363 tipos de producto |
| `db/ads/openads/data/domdia.adt` | 52.585 cabeceras (2015–2026) |
| `db/ads/openads/data/domite.adt` | 240.841 líneas |
| `db/ads/openads/data/tidsal.adt` | 51.938 artículos-sucursal |

## 1. Campos que ya escribimos

| Tabla | Campos |
|---|---|
| `TIDSAL` | `INARTIC`, `INNOMBRE`, `INVRVENTA1`, `INVRVENTA0`, `INSALDO00`, `INSUC` |
| `TIDMARCAS` | `MCODIGO`, `MNOMBRE` |
| `TIDTAB` | `CTABCOD`, `CTABDES` |
| `TIDTPRO` | `CODIGO`, `NOMBRE`, `HABILITA` |
| `POSCLI` | `CODCLI`, `NOMCLI`, `NOMBRE`, `APELLIDO`, `CEDCLI`, `TIPODOC`, `EMAIL`, `TELCELU`, `SUCURSAL`, `ORIGENW`, `BLOQUE` |
| `DOMDIA` | 28 campos de cabecera (`FAPEDIDO`, `FACODIGO`, totales, pagos 1–3, `FACONTROL`…) |
| `DOMITE` | 19 campos de línea (`IFARTIC`, `IFEAN`, cantidades, precios, IVA, estado…) |

## 2. Códigos cerrados

| # | Tema | Decisión | Evidencia |
|---|---|---|---|
| 1 | Numeración | `FAPEDIDO` = `IFPEDIDO` = **9 dígitos** (`ERP_ORDER_PREFIX` + id, prefijo por defecto `9`). `FAFACTURA` vacía hasta que el ERP facture. | `DOMITE.IFPEDIDO` es `char(9)`; es el único enlace posible antes de facturar. |
| 2 | Estado cabecera | `FAESTADO`: **0** pendiente, **5** cancelado, **9** facturado/entregado. | 52.585 filas: 50.758 con 9 y factura; las filas con 5 tienen `FAOBSER` “CANCELADO” y totales 0; las de 0 son pedidos demo 2026 sin factura. |
| 3 | Estado línea | `IFESTADO`: **vacío** = normal (en disco se lee `32768`, centinela nulo de `bin2`), **5** = cancelada. | Cruce `DOMITE.IFFACT`→`DOMDIA.FAFACTURA`: cabecera 5 ⇒ 1.189 líneas con 5; cabecera 9 ⇒ 235.810 líneas con 32768 (vacías). |
| 4 | Tipo de domicilio | `FATIPODOM = '01'` (domicilio). | 42.391 de 52.585 filas; `02` 9.427 y `03` 766. El ecommerce sólo maneja entrega a domicilio. |
| 5 | Ciudad | **Sin diccionario**: `FACIUDAD` es texto libre de 12. Se envía el nombre (`Manizales`). | `POSDANE` contiene 1.647 EAN + nombres de producto, no ciudades. Sólo 1 fila de `DOMDIA` tiene ciudad y dice “Manizales”. |
| 6 | Pagos | `CASH→EF`, `CARD→TC`, `PSE/BANK_TRANSFER/NEQUI/DAVIPLATA/BREB→TF`. | `POSPAGO`: `EF` EFECTIVO, `TC` TARJETA CREDITO, `TF` TRANSFERENCIA BANCARIA. Los flags `VALIDAWEB`/`PERMIDSI` no cubren estos códigos; se guardan en `meta` para consulta. |
| 7 | Impuestos | `DOMITE.IFTIMP` **no se usa** (vacío en el 100 % de las filas reales). Se envía `IFPORIVA` con la tarifa (0, 5, 16, 19). En catálogo, `TIDSAL.INTIMP`: `J=19 %`, `C=5 %`, `E=0 %`, `B=bolsa`. | `DOMITE.IFTIMP` vacío en 240.841/240.841; `IFPORIVA` 0/16/5/19. `TIDSAL.INTIMP` J=35.667, E=11.827, C=4.441. |
| 8 | Enlace líneas | `DOMITE.IFPEDIDO = DOMDIA.FAPEDIDO`; `IFFACT = ''` hasta la factura. | Las líneas reales tienen `IFPEDIDO` y `IFFACT`; el pedido se factura después. |
| 9 | Bodega | `IFBODEGA = '00'`. | `TIDSAL.INBODEGA = '00'` en las 51.938 filas (bodega consolidada); `TIDBODE` tiene 29 bodegas de tienda, pero el stock del catálogo está en 00. |
| 10 | Envío | `FAVARIOS` = costo de envío + impuesto de envío. `FAVLRFLE` se deja vacío. | `FAVLRFLE` vacío en las filas reales; los pedidos demo enviados con `FAVARIOS` cuadran. |

Estos mapas viven en `erp_code_map` (migración `24_erp_code_map_fortuner.sql` y
`sync-codes.mjs`). Se pueden corregir con `UPDATE` sin tocar código.

## 3. Defectos técnicos corregidos

1. **Códigos generados más largos que la columna**
   - `newErpCode(id, length)` respeta `char(8)` de `TIDMARCAS.MCODIGO`,
     `char(7)` de `TIDTAB.CTABCOD` y `char(13)` de `POSCLI.CODCLI`.
2. **Recortes**
   - `POSCLI.CEDCLI(10)`, `EMAIL(50)`, `NOMBRE/APELLIDO(50)`,
     `TELCELU(12)`, `TIPODOC(2)`, `SUCURSAL(3)`.
   - `TIDTAB.CTABDES(45)`, `TIDTPRO.NOMBRE(30)`, `TIDMARCAS.MNOMBRE(80)`.
   - `FAPEDIDO/IFPEDIDO(9)`, `FASUCUR/IFSUCUR(3)`.
3. **Tipos**
   - `TIDSAL.INSUC` se escribe **numérico** (es `double`).
   - `FAESTADO`/`IFESTADO` se escriben **numéricos** (son `bin2`); `IFESTADO`
     normal se **omite** (en disco queda el centinela nulo `32768`).
   - `FASUCUR`/`IFSUCUR` son `char(3)`: se escriben como texto `01`, `02`, `11`.

## 4. Campos adicionales que sí podemos llenar

### `DOMDIA` (cabecera)

| Campo ERP | Origen en Postgres | Nota |
|---|---|---|
| `FAPEDINT` char(25) | `orders.reference_code` / `orders.id` | pedido interno |
| `FAFPAGO` | `payments.paid_at` | fecha de pago |
| `FADOCPAGO` char(15) | `payments.provider_transaction_id` | recortar a 15 |
| `FAOBSERVEN` char(30) | `orders.internal_notes` | recortar a 30 |
| `DIRIP` | `orders.customer_ip` | IP del cliente |
| `FATIPPER` char(1) | `customers.customer_type` | requiere diccionario persona/empresa |
| `FACANALV` | constante `WEB` | canal |
| `FAHORAD` / `FAHORAE` | `delivery_time_slots` | si se usa ventana horaria |

### `DOMITE` (líneas)

| Campo ERP | Origen en Postgres | Nota |
|---|---|---|
| `IFNUMERO` int32 | secuencia de `order_items` | nº de línea |
| `IFCOSTO` double | `product_variants.cost_price` | costo unitario |
| `IFTPRO` char(3) | `products.product_type` / `TIDTPRO.CODIGO` | tipo de producto |
| `IFFCHPED` int32 | `orders.created_at` | fecha del pedido |
| `IFPROVEE` char(13) | `supplier_products` | proveedor |

### `POSCLI` (clientes)

Hoy escribimos 11 de 89 campos. Podríamos añadir:

| Campo ERP | Origen en Postgres |
|---|---|
| `DIRCLI1`, `DIRCLI2` | `customer_addresses.address_line1/2` |
| `BARRIO1`, `CODBARRIO` | `customer_addresses.reference` / `state` |
| `CIUCLI`, `CIUDAD` | `customer_addresses.city` (texto) |
| `TELCLI1`, `TELCLI2` | `customers.phone` |
| `FECHAN` | `customers.birth_date` |
| `SEXO` | `customers.gender` |
| `FECHAI`, `FECHAMOD` | `customers.created_at/updated_at` |
| `TIPCLI` | `customers.customer_type` |
| `CLAWEB`, `NEWWEB` | constantes del canal web |
| `NITEMPRE` | `customers.document_number` (si es empresa) |

### `TIDSAL` / maestras

| Campo ERP | Origen en Postgres |
|---|---|
| `INEAN` | `product_variants.barcode` (recortado a 13) |
| `INNOMBRE` | `products.name` (60) |
| `INNOMBRE3` | atributo `nombre-corto` (fallback: `products.name` a 20) |
| `INNOMBRE4` | atributo `nombre-largo` (nombre de facturación) |
| `INTIPO` | `product_type_assignments` → `product_types.code` |
| `INMARCAP` | `brands.name` (20) |
| `INMARCA` | **no se escribe**: no coincide con `TIDMARCAS.MCODIGO` (ver nota) |
| `INCATE` | atributo `categoria-erp` (6) |
| `INUNIDAD` | atributo `unidad-medida` (2) |
| `INPRESEN` | atributo `presentacion` (3) |
| `INEMBALAJE` | atributo `unidades-empaque` |
| `INPARTE` | atributo `referencia-fabricante` (16) |
| `ININVIMA` | atributo `registro-invima` (20) |
| `INCUM` | atributo `cum` (18) |
| `INUBIC` | atributo `ubicacion-bodega` (10) |
| `INEAN14` | atributo `ean-caja` (14) |
| `INTIMP` / `INIMPC` | `tax_rates.rate` (pendiente de cerrar semántica) |
| `INCOSTO00` | **no se propaga** (copia local inflada; confirmar) |
| `INMINIMO` / `INMAXIMO` | reglas de stock (pendiente) |
| `INALTO` / `INANCHO` / `INLARGO` | `product_variants.*_mm / 10` (cm) |
| `INWEB` / `INAPP` / `SACATWEB` | **los gobierna el ERP** (solo lectura al importar) |
| `INACTIVO` | `products.is_active` / `product_variants.is_active` (`A`/`I`; no pisa `S`) |
| `INPROVEE` | `supplier_products` (pendiente) |
| `TIDTPRO.HABILITA` | `product_types.is_active` |

> **Hallazgo `INMARCA`**: en la copia, `SALSA FRUCO ...` tiene
> `INMARCA='2000145'`, pero `TIDMARCAS` asigna `2000145` a `AESSY OFF` y `49` a
> `FRUCO`. Por eso el agente **no escribe** `INMARCA`; sólo actualiza
> `INMARCAP` (nombre). Hay que confirmar con el ERP qué tabla referencia
> realmente `INMARCA` antes de tocarlo.

## 5. Campos que no podemos llenar (no hay dato)

- Vehículo/placa: `DOMDIA.FAPLACA`, `FACIA`, `DOMITE.IFPLACA`.
- Vendedor: `FAVENDED`, `IFVENDED`.
- Retenciones: `FAVLRRETV`, `FAVLRRETI`, `IFVLRRETV`, `IFVLRRETI`.
- Contabilidad: `FACOND`, `FAPTOFAC`, `FASECTO`, `IFCCOSTO`.
- Lotes/vencimientos: `IFLOTE`, `CONLOTES`.
- Caja/mesa: `IFCAJA`, `IFMESA`.
- Factura/numeración: `FAFACTURA` (la asigna el ERP).
- Descuentos financieros y otros impuestos: `FAVLDESFI`, `IFVLDESFI`,
  `FAVLRIMC`, `FAVLROIP`.

## 6. Preguntas abiertas (requieren al responsable del ERP)

1. **Categorías**: ¿el catálogo web nace en `TIDTAB` (lo que usamos hoy) o en
   `TIDCATE` (`CATE1..3`, `CARAC1..6`, `IMAGEN`, `HABILITA`)?
2. **Pedidos**: ¿el ERP factura desde `DOMDIA`/`DOMITE` (domicilios) o espera
   `PEDDIA`/`PEDITE` (pedidos, casi vacías)?
3. **Alta de artículos**: ¿el ecommerce puede crear artículos nuevos en `TIDSAL`
   (304 campos) o el ERP sigue siendo el único que los crea?
4. **Facturación**: confirmar que con `FAPEDIDO`/`IFPEDIDO` y estado 0 el ERP
   lista el pedido para facturar y, al facturar, llena `FAFACTURA`/`IFFACT`.
5. **`INMARCA`**: ¿qué tabla referencia? En la copia, FRUCO tiene
   `INMARCA=2000145`, pero `TIDMARCAS` asigna `2000145` a AESSY OFF y `49` a
   FRUCO. Hasta confirmarlo, el agente sólo escribe `INMARCAP` (nombre).
6. **`INCATE`**: los valores de `TIDSAL` son de 6 dígitos (ej. `050703`) y no
   salen del árbol de categorías web; confirmar si vienen de `TIDCATE` o de
   otra tabla. Hoy se conserva el atributo `categoria-erp`.

## 7. Siguiente paso

1. Aplicar `db/sql/24_erp_code_map_fortuner.sql` y `25_erp_product_outbox.sql` con
   `node scripts-agent/erp/init-db.mjs`, y ejecutar `sync-codes.mjs`.
2. Desplegar según `docs/DESPLIEGUE-ERP-FORTUNER.md`.
3. Piloto contra una **copia de trabajo** de FORTUNER:
   `push-orders.mjs --dry-run`, luego `--limit=3 --apply`.
4. Validar en el ERP que el pedido aparece pendiente y que la factura se genera
   con las líneas correctas.
4. Recién entonces promover a producción con outbox y conciliación.
