# Mapeo de campos — Postgres (ecommerce) ⇄ Advantage (`ADD_FORTUNER`)

Registro del mapeo campo a campo entre las tablas operativas de Postgres y las
tablas del ERP Advantage. Es la referencia única de la integración; los scripts
que la implementan son:

| Script | Dirección |
|---|---|
| `sync-catalog.mjs` | ERP `TIDSAL` + maestras → `products`, `product_variants`, `prices`, `inventory`, `branch_products`, `brands`, `categories`, `product_types`, `attributes`, relaciones |
| `sync-customers.mjs` | ERP `POSCLI` → `customers` |
| `sync-codes.mjs` | `.ADT` → `erp_code_map` (diccionarios de códigos) |
| `push-catalog.mjs` | `erp_outbox` → `TIDSAL` / `TIDMARCAS` / `TIDTAB` / `TIDTPRO` |
| `push-orders.mjs` | `orders` / `order_items` / `payments` → `DOMDIA` / `DOMITE` |
| `reconcile.mjs` | `erp_invoices` → `invoices` + estado de `orders` |

**Convención de sentido:** `←` Advantage → Postgres (pull, fuente de verdad) ·
`→` Postgres → Advantage (push) · `⇄` ambas direcciones · `local` solo Postgres
(contenido web) · `—` sin mapeo (no aplica o pendiente).

**Llaves de la integración:**
- Producto: `TIDSAL.INARTIC` = `products.external_id` = `product_variants.sku`.
- Sucursal/bodega: `TIDSAL.INSUC` = `branches.code` (1, 2, 11).
- Cliente: `POSCLI.CODCLI` = `customers.erp_customer_code` / `provider_id`.
- Pedido: `orders.reference_code` → `DOMDIA.FACONTROL`; `orders.id` → `DOMDIA.FAPEDIDO` (9 dígitos).
- Marca: `TIDMARCAS.MCODIGO` = `brands.code` (nombre real en `TIDSAL.INMARCAP`).
- Categoría: `TIDTAB.CTABCOD` = `categories.code` (el producto se liga por prefijo del SKU).
- Tipo: `TIDTPRO.CODIGO` = `product_types.code` (`TIDSAL.INTIPO`).

---

## 1. Catálogo

### 1.1 `products` ← `TIDSAL`

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `id` | — | local | PK local |
| `external_id` | `INARTIC` | ← | clave de la integración |
| `name` | `INNOMBRE` | ⇄ | push escribe `INNOMBRE` |
| `brand_id` | `TIDMARCAS` vía `INMARCAP` | ← | se resuelve por nombre de marca |
| `plu` | `NUMERO` | ← | |
| `slug` | — | local | generado de `name` |
| `description` | `INNOMBRE4`/`INNOMBRE` + marca/presentación/empaque/INVIMA | ← parcial | descripción web larga es local |
| `product_type` | — | local | literal `SIMPLE` |
| `sku_prefix` | `INARTIC[:6]` | local | derivado |
| `manufacturer` | `INMARCAP` (nombre de marca) | ← | legado: guarda el nombre, no código |
| `visibility` | — | local | literal `PUBLIC` |
| `is_public` | `INWEB` (`T`) | ← | |
| `is_active` | `INACTIVO` (`A`) | ⇄ | OR entre sucursales; push escribe `INACTIVO` |
| `featured`, `published_at` | — | local | colecciones web |
| `created_at`/`updated_at` | — | local | |
| `deleted_at` | — | local | soft delete (no se borra del ERP) |

### 1.2 `product_variants` ← `TIDSAL`

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `product_id` | — | local | FK a `products.id` |
| `sku` | `INARTIC` | ← | clave; el artículo del ERP no tiene variantes |
| `barcode` | `INEAN` | ⇄ | EAN duplicado → `NULL` |
| `current_price` | `INVRVENTA1` | ← | de la sucursal primaria |
| `current_compare_price` | `INVRVENTA0` | ← | si `0 < v0 <= v1` |
| `cost_price` | `INVRULTC` (o `INCOSTO00`) | ← | |
| `length_mm` | `INLARGO` ×10 | ⇄ | ERP en cm, PG en mm |
| `width_mm` | `INANCHO` ×10 | ⇄ | |
| `height_mm` | `INALTO` ×10 | ⇄ | |
| `is_active` | `INACTIVO` | ⇄ | push vía `product_flags` |
| `created_at`/`updated_at`/`deleted_at` | — | local | |

### 1.3 `prices` ← `TIDSAL` (por sucursal)

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `product_variant_id` + `branch_id` | `INARTIC` + `INSUC` | ← | llave compuesta |
| `price` | `INVRVENTA1` | ⇄ | push: `UPDATE tidsal SET INVRVENTA1` |
| `compare_price` | `INVRVENTA0` | ⇄ | push: `INVRVENTA0` |
| `cost` | `INVRULTC` / `INCOSTO00` | ← | |
| `changed_by` / `change_reason` | — | local | `ADMIN` / `Sync ERP` |
| `version` | — | local | se incrementa en cada sync |
| `start_date` / `end_date` | — | local | historial de precios |

### 1.4 `inventory` ← `TIDSAL`

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `stock` | `INSALDO00` | ⇄ | push: `UPDATE tidsal SET INSALDO00` |
| `reorder_point` | `INPTOPOS` | ← | |
| `minimum_stock` | `INMINIMO` | ← | |
| `maximum_stock` | `INMAXIMO` | ← | |
| `reserved_stock`, `last_movement_at`, `last_counted_at`, `target_stock` | — | local | |

### 1.5 `branch_products` ← `TIDSAL`

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `branch_id` + `product_id` | `INSUC` + `INARTIC` | ← | |
| `is_public` | `INWEB` (`T`) | ← | |
| `is_available` | `INACTIVO` (`A`) | ← | |

### 1.6 `branches` ← `TIDBODE`  *(F1: hoy placeholder)*

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `code` | `TIDBODE.CODIGO` | ← | 1, 2, 11 |
| `name` | `TIDBODE.NOMBRE` | ← pendiente | hoy se inventa `TID Sucursal N` |
| `address`, `city`, `phone`, `email`, `location`, `delivery_radius_km`, `schedule` | — | local | ciudad fija "Manizales" |
| `store_id` | — | local | |
| `branch_type` | — | local | `STORE` |
| `is_active` | — | local | |

### 1.7 `categories` / `product_categories` ← `TIDTAB`

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `code` | `TIDTAB.CTABCOD` | ⇄ | clave de 1/3/5/7 dígitos |
| `name` | `TIDTAB.CTABDES` | ⇄ | push: `UPDATE tidtab SET CTABDES` |
| `parent_id` | `TIDTAB.CTABCOD1` | ⇄ | push: `CTABCOD1` |
| `level` | profundidad del árbol | ← | |
| `is_active` | — | local | se ocultan categorías viejas sin uso |
| `slug`, `description`, `image_media_id`, `meta_title`, `meta_description`, `display_order` | — | local | |
| `product_categories.product_id` | producto | local | ligado por `categoryOf(INARTIC)` (prefijo del SKU); **`TIDSAL.INCATE` no es fiable** |

> `TIDCATE` (174 filas, electrodomésticos) **no** es el árbol del catálogo de
> alimentos; el árbol real es `TIDTAB` (231 nodos).

### 1.8 `product_types` / `product_type_assignments` ← `TIDTPRO`

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `code` | `TIDTPRO.CODIGO` | ⇄ | 3 posiciones |
| `name` | `TIDTPRO.NOMBRE` | ⇄ | push: `UPDATE tidtpro SET NOMBRE, HABILITA` |
| `is_active` | `TIDTPRO.HABILITA` | ← pendiente | hoy no se trae (6 activos manuales) |
| `description`, `image_media_id` | — | local | |
| `product_type_assignments.product_id` | producto | local | ligado por `TIDSAL.INTIPO` |

### 1.9 `attributes` / `product_attributes` ← columnas de `TIDSAL`

| Atributo (`slug`) | Advantage | Notas |
|---|---|---|
| `unidad-medida` | `INUNIDAD` | texto libre |
| `presentacion` | `INPRESEN` | |
| `nombre-corto` | `INNOMBRE3` | etiquetas/ticket |
| `nombre-largo` | `INNOMBRE4` | facturación |
| `unidades-empaque` | `INEMBALAJE` | |
| `ean-caja` | `INEAN14` | EAN-14 |
| `referencia-fabricante` | `INPARTE` | |
| `registro-invima` | `ININVIMA` | |
| `cum` | `INCUM` | |
| `ubicacion-bodega` | `INUBIC` | |
| `categoria-erp` | `INCATE` / prefijo SKU | informativo |
| `marca-erp` | `INMARCA` | solo informativo (no es FK) |

### 1.10 `product_tax_classes` / `tax_rates` ← `TIDSAL.INTIMP` + `TIDTIPOS`

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `tax_rates.code` | `TIDTIPOS.TIPO` (`CLASE='IM'`) | ← pendiente | hoy hardcodeado `J/C/E` |
| `product_tax_classes.tax_rate_id` | `TIDSAL.INTIMP` | ← | `J`→IVA19, `C`→IVA5, `E`→EXENTO |

---

## 2. Marcas (`brands` ← `TIDMARCAS` + `TIDSAL.INMARCAP`)

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `code` | `TIDMARCAS.MCODIGO` | ⇄ | 8 posiciones |
| `name` | `TIDMARCAS.MNOMBRE` (o `INMARCAP`) | ⇄ | push renombra `MNOMBRE` y refresca `TIDSAL.INMARCAP` |
| `is_active` | — | local | hoy no hay baja de marcas |
| `slug`, `logo_media_id`, `website`, `description`, `country`, `is_public`, `is_featured` | — | local | |

> `TIDSAL.INMARCA` **no** se usa como FK: en la base no coincide con
> `TIDMARCAS.MCODIGO`. El nombre real del artículo viene en `INMARCAP`.

---

## 3. Clientes (`customers` ← `POSCLI`)

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `erp_customer_code` | `CODCLI` | ⇄ | 13 posiciones; es la clave |
| `provider` / `provider_id` | — | ← | `ERP` / `CODCLI` |
| `first_name` | `NOMBRE` + `NOMBRE2` | ← | |
| `last_name` | `APELLIDO` + `APELLIDO2` | ← | |
| `document_number` | `CEDCLI` | ← | |
| `document_type` | `TIPODOC` | ← | |
| `email` | `EMAIL` | ← | si falta se sintetiza `<CODCLI>@erp.mercaldas.local` |
| `phone` | `TELCELU` / `TELCLI1` / `TELCLI2` | ← | |
| `is_active` | `BLOQUE != 'T'` | ← | |
| resto (password, preferencias, tokens, `created_at`…) | — | local | |

> Un cliente `provider='local'` **no** se sobrescribe desde el ERP. La dirección de
> entrega vive en `customer_addresses` (local); solo se copia al pedido (`DOMDIA`).

---

## 4. Pedidos (`orders` / `order_items` / `payments` → `DOMDIA` / `DOMITE`)

### 4.1 `orders` → `DOMDIA` (cabecera)

| Advantage | Postgres | Notas |
|---|---|---|
| `FASUCUR` | `orders.branch_id` → `branches.code` | 2 dígitos |
| `FAPEDIDO` | `orders.id` | 9 dígitos (prefijo web) |
| `FACONTROL` | `orders.reference_code` | idempotencia |
| `FACODIGO` | `customers.erp_customer_code` / `document_number` | |
| `FANOMBRE` | `customer_name` | |
| `FADIREC` | `customer_addresses.address_line1+2` | |
| `FACIUDAD` | `customer_addresses.city` | |
| `FATELEF` / `FACELU` | `customer_phone` | |
| `FANIT` | `document_number` | |
| `FAEMAIL` | `customer_email` | |
| `FAFCHFAC` + `FATIME` | `created_at` (zona Bogotá) | `YYYYMMDD` + `HH:MM:SS` |
| `FAVLRBRU` | `subtotal` | |
| `FAVLRDES` | `discount_total` | |
| `FAVLRIVA` | `tax_total` | |
| `FAVARIOS` | `shipping_cost + shipping_tax` | |
| `FAVLRNET` | `grand_total` | |
| `FAPAG01..03` / `FAVLR01..03` | `payments.payment_method` / `amount` | máx. 3 pagos |
| `FATIPODOM` | — | fijo `01` |
| `FAESTADO` | `orders.status` | `0` pendiente / `9` entregado / `5` cancelado |
| `FAOBSER` | `notes` | |

### 4.2 `order_items` → `DOMITE` (líneas)

| Advantage | Postgres | Notas |
|---|---|---|
| `IFPEDIDO` | `order_id` | = `FAPEDIDO` |
| `IFCLIENTE` | `CODCLI` | |
| `IFFACT` | — | vacío hasta facturar |
| `IFARTIC` | `variant_sku` | SKU del artículo |
| `IFEAN` | `product_variants.barcode` | |
| `IFNOMBRE` | `product_name` | |
| `IFCANT` | `quantity` | |
| `IFVLRUNI` | `unit_price_gross` | |
| `IFVLRBRU` | `subtotal` (base sin IVA) | |
| `IFPORIVA` | `tax_rate` | |
| `IFVLRIVA` | `tax_amount` | |
| `IFVLRNET` | `total` | |
| `IFPORDES` | — | `0` |
| `IFVLRDES` | `discount_amount` | |
| `IFESTADO` | — | vacío = normal, `5` = cancelada |
| `IFFECHA` | `created_at` | `YYYYMMDD` |
| `IFTIPO` | — | `E` (venta) |
| `IFSUCUR` / `IFBODEGA` | `branch_code` / fijo | `IFBODEGA='00'` |

### 4.3 Estado inverso (`→` por `order_status`)

`orders.status` → `erp_code_map(order_status)` → `DOMDIA.FAESTADO` (+ `DOMITE.IFESTADO` al cancelar).

---

## 5. Facturación (`invoices` ← `erp_invoices` ← `FADDIA`)

| Postgres | Advantage | Sentido | Notas |
|---|---|---|---|
| `invoice_number` | `FADDIA.FAFACTURA` | ← | vía `erp_invoices.factura` |
| `issued_at` | `FADDIA.FAFCHFAC` | ← | |
| `cufe_code` | `FADDIA` CUFE | ← | |
| `status` | `FADDIA.FAESTADO`/`FATIPO` | ← | `AN`→cancel, `RE`→refund |
| `orders.erp_document_ref` | `FAFACTURA` | ← | vínculo factura→pedido |
| `orders.status` | `FATIPO` | ← | al facturar |

Vínculo: `erp_invoices.domicilio` = nº de pedido (`FAPEDIDO`).

---

## 6. Proveedores *(sin conectar — fuente disponible)*

| Postgres | Advantage | Estado |
|---|---|---|
| `suppliers.code` | `TIDSAL.INPROVEE` / `TIDLISTA.INPROVEE` (1.587) | pendiente |
| `suppliers.legal_name` | `TIDLISTA` proveedor (falta maestro de proveedores) | pendiente |
| `supplier_products.purchase_price` | `TIDLISTA.INVALOR` | pendiente |
| `supplier_products.*` descuentos | `TIDLISTA.INDCTO1..6`, `INFECHA1/2` | pendiente |

No hay tabla maestro de proveedores evidente en el ERP; los códigos se infieren de
`INPROVEE`. Requiere validar con el ERP antes de conectar.

---

## 7. Diccionarios de códigos (`erp_code_map`)

| dominio | Fuente | Uso |
|---|---|---|
| `brand` | `TIDMARCAS` | `sync-catalog` resuelve marca por código |
| `product_type` | `TIDTPRO` | `sync-catalog` |
| `tax` | `TIDTIPOS` (`CLASE='IM'`) | conversión de tasas |
| `warehouse` | `TIDBODE` | sucursales (hoy 29 vs 3 reales → regenerar) |
| `payment_method` | `POSPAGO` | `push-orders` |
| `order_status` | `DOMDIA.FAESTADO` | `push-catalog` / `reconcile` |
| `city` | — (sin fuente) | `POSDANE` no contiene ciudades |

---

## 8. Tablas de control de la integración

| Tabla Postgres | Propósito |
|---|---|
| `erp_outbox` | cola PG → ERP: `kind` (`price`, `stock`, `brands`, `categories`, `product_types`, `products`, `product_flags`, `order_status`), `payload`, `status`, `idempotency_key` |
| `erp_snapshot` | huella por fila (`erp_key`, `hash`, `erp_table`) para el diff de `TIDSAL` y `POSCLI` (falta extender a maestros) |
| `erp_code_map` | códigos ERP ↔ canonical del ecommerce |
| `erp_invoices` / `erp_payments` | espejo de `FADDIA` / `FAPAGO` para conciliar |

### Qué reencola cada trigger (PG → `erp_outbox`)

| Tabla vigilada | `kind` | Destino ERP |
|---|---|---|
| `product_variants` (precio) | `price` | `TIDSAL.INVRVENTA1/0` |
| `inventory` (stock) | `stock` | `TIDSAL.INSALDO00` |
| `brands` | `brands` | `TIDMARCAS` + `TIDSAL.INMARCAP` |
| `categories` | `categories` | `TIDTAB` |
| `product_types` | `product_types` | `TIDTPRO` |
| `products` | `products` | `TIDSAL` (nombre, EAN, atributos, dimensiones) |
| `products`/`product_variants` (activación) | `product_flags` | `TIDSAL.INACTIVO` |
| `orders` (estado) | `order_status` | `DOMDIA.FAESTADO` |

> Todos los pulls (`sync-*`) arrancan con `SET app.erp_sync='on'` para que estos
> triggers **no** reencolen lo que acaba de llegar del ERP (anti ping-pong).

---

## 9. Lo que Postgres posee (el ERP no lo toca)

- **Imágenes y media**: `media`, `product_images`, `brands.logo_media_id`,
  `categories.image_media_id`, `product_types.image_media_id`.
- **Contenido y SEO**: `products.description` larga, `slug`, `meta_title/meta_description`.
- **Comercio web**: colecciones (`featured_product_tabs`, `featured_product_assignments`),
  `promotions`, `popups`, `pages`, `saved_filters`, `shelves`/`shelf_categories`.
- **Logística de entrega**: `delivery_*`, `shipments`, `inventory_reservations`,
  `picker_chat_messages`, `driver_chat_messages`.
- **Usuarios y sesiones**: `users`, `roles`, `user_sessions`, `customer_tokens`, etc.
- **Campañas**: `newsletter_*` (eso ya vive en el CRM, repo hermano).
