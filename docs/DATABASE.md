# Modelo de datos — Ecommerce (Postgres)

> Documento **generado** desde el esquema real de la base de datos `ecommerce`.
> Fuente de verdad: `backend/drizzle/schema.ts`. Generador: `scripts-agent/gen-db-docs.mjs`.
> Última generación: 2026-10-08.

## Resumen

- Tablas base: **90**
- Columnas totales: **999**
- Extensiones: `citext`, `fuzzystrmatch`, `pg_trgm`, `plpgsql`, `postgis`, `postgis_tiger_geocoder`, `postgis_topology`, `unaccent`, `uuid-ossp`
- BD local: `postgresql://postgres:postgres@localhost:5432/ecommerce`

Filas por tabla (conteo exacto al momento de generar):

| Tabla | Filas | Dominio |
|---|---:|---|
| `products` | 21.613 | Núcleo de catálogo |
| `product_variants` | 21.613 | Núcleo de catálogo |
| `brands` | 2.569 | Núcleo de catálogo |
| `categories` | 173 | Núcleo de catálogo |
| `product_categories` | 21.613 | Núcleo de catálogo |
| `product_types` | 367 | Núcleo de catálogo |
| `product_type_assignments` | 21.611 | Núcleo de catálogo |
| `attributes` | 9 | Núcleo de catálogo |
| `attribute_options` | 0 | Núcleo de catálogo |
| `variant_attributes` | 0 | Núcleo de catálogo |
| `product_attributes` | 138.300 | Núcleo de catálogo |
| `product_tax_classes` | 21.613 | Impuestos y proveedores |
| `tax_rates` | 3 | Impuestos y proveedores |
| `suppliers` | 753 | Impuestos y proveedores |
| `supplier_products` | 21.613 | Impuestos y proveedores |
| `branches` | 10 | Sucursales, inventario y precios |
| `branch_products` | 51.938 | Sucursales, inventario y precios |
| `inventory` | 51.938 | Sucursales, inventario y precios |
| `inventory_movements` | 0 | Sucursales, inventario y precios |
| `inventory_reservations` | 0 | Sucursales, inventario y precios |
| `prices` | 49.036 | Sucursales, inventario y precios |
| `product_locations` | 0 | Sucursales, inventario y precios |
| `shelves` | 41 | Sucursales, inventario y precios |
| `shelf_categories` | 181 | Sucursales, inventario y precios |
| `user_branches` | 8 | Sucursales, inventario y precios |
| `customers` | 44 | Clientes (B2C) |
| `customer_addresses` | 6 | Clientes (B2C) |
| `customer_payment_methods` | 1 | Clientes (B2C) |
| `customer_sessions` | 0 | Clientes (B2C) |
| `customer_refresh_tokens` | 18 | Clientes (B2C) |
| `customer_tokens` | 0 | Clientes (B2C) |
| `guest_sessions` | 12 | Clientes (B2C) |
| `users` | 9 | Usuarios y seguridad (admin) |
| `roles` | 4 | Usuarios y seguridad (admin) |
| `permissions` | 22 | Usuarios y seguridad (admin) |
| `role_permissions` | 34 | Usuarios y seguridad (admin) |
| `user_roles` | 3 | Usuarios y seguridad (admin) |
| `user_sessions` | 0 | Usuarios y seguridad (admin) |
| `user_refresh_tokens` | 210 | Usuarios y seguridad (admin) |
| `audit_logs` | 0 | Usuarios y seguridad (admin) |
| `saved_filters` | 7 | Usuarios y seguridad (admin) |
| `settings` | 6 | Usuarios y seguridad (admin) |
| `carts` | 8 | Carrito y pedidos |
| `cart_items` | 51 | Carrito y pedidos |
| `orders` | 98 | Carrito y pedidos |
| `order_items` | 242 | Carrito y pedidos |
| `order_status_history` | 576 | Carrito y pedidos |
| `invoices` | 0 | Carrito y pedidos |
| `payments` | 98 | Carrito y pedidos |
| `payment_intents` | 2 | Carrito y pedidos |
| `refunds` | 0 | Carrito y pedidos |
| `shipments` | 66 | Carrito y pedidos |
| `coupons` | 0 | Promociones y cupones |
| `coupon_redemptions` | 0 | Promociones y cupones |
| `promotions` | 0 | Promociones y cupones |
| `promotion_conditions` | 0 | Promociones y cupones |
| `promotion_products` | 0 | Promociones y cupones |
| `delivery_drivers` | 7 | Entrega / delivery |
| `delivery_assignments` | 78 | Entrega / delivery |
| `delivery_events` | 226 | Entrega / delivery |
| `delivery_driver_locations` | 962 | Entrega / delivery |
| `delivery_proof_media` | 0 | Entrega / delivery |
| `delivery_zones` | 0 | Entrega / delivery |
| `delivery_time_slots` | 0 | Entrega / delivery |
| `driver_chat_messages` | 10 | Entrega / delivery |
| `order_chat_messages` | 0 | Entrega / delivery |
| `picker_chat_messages` | 4 | Picking y listas |
| `shopping_lists` | 0 | Picking y listas |
| `shopping_list_items` | 0 | Picking y listas |
| `favorites` | 0 | Picking y listas |
| `banners` | 10 | Contenido / CMS |
| `pages` | 0 | Contenido / CMS |
| `menus` | 0 | Contenido / CMS |
| `menu_items` | 0 | Contenido / CMS |
| `popups` | 1 | Contenido / CMS |
| `store` | 1 | Contenido / CMS |
| `media` | 15.705 | Contenido / CMS |
| `featured_product_tabs` | 4 | Contenido / CMS |
| `featured_product_assignments` | 96 | Contenido / CMS |
| `campaigns` | 10 | Marketing y notificaciones |
| `campaign_history` | 17 | Marketing y notificaciones |
| `campaign_messages` | 15 | Marketing y notificaciones |
| `campaign_products` | 12 | Marketing y notificaciones |
| `campaign_recipients` | 9.529 | Marketing y notificaciones |
| `newsletter_campaigns` | 0 | Marketing y notificaciones |
| `newsletter_subscribers` | 1 | Marketing y notificaciones |
| `notifications` | 40 | Marketing y notificaciones |
| `background_jobs` | 0 | Infraestructura |
| `spatial_ref_sys` | 8.500 | Sistema (PostGIS) |
| `product_images` | 15.597 | (sin clasificar) |

## Convenciones del modelo

- **Claves primarias**: normalmente `id` (`serial`/`uuid`); en tablas puente la PK es compuesta.
- **Borrado lógico**: columnas `deleted_at` / `is_active` en varias entidades.
- **Multi-sucursal**: el catálogo se distribuye por sucursal mediante `branches`, `branch_products`, `inventory` y `prices`.
- **Medios**: todo apunta a `media`; `provider` indica origen (`local`/`cloudinary`).
- **Tipos**: los tipos mostrados usan `varchar(n)` con `n` real; `numeric(p,s)` indica precisión/escala.

## Diagrama entidad-relación (núcleo)

```mermaid
erDiagram
  BRANCHES ||--o{ BRANCH_PRODUCTS : contiene
  BRANCHES ||--o{ INVENTORY : almacena
  BRANCHES ||--o{ PRICES : precio_sucursal
  PRODUCTS ||--o{ PRODUCT_VARIANTS : tiene
  PRODUCTS ||--o{ PRODUCT_CATEGORIES : clasifica
  CATEGORIES ||--o{ PRODUCT_CATEGORIES : agrupa
  PRODUCTS ||--o{ PRODUCT_TYPE_ASSIGNMENTS : tipifica
  PRODUCT_TYPES ||--o{ PRODUCT_TYPE_ASSIGNMENTS : agrupa
  PRODUCTS ||--o{ PRODUCT_IMAGES : muestra
  MEDIA ||--o{ PRODUCT_IMAGES : archivo
  PRODUCT_VARIANTS ||--o{ INVENTORY : stock
  PRODUCT_VARIANTS ||--o{ PRICES : precio
  CUSTOMERS ||--o{ ORDERS : compra
  ORDERS ||--o{ ORDER_ITEMS : detalle
  PRODUCT_VARIANTS ||--o{ ORDER_ITEMS : referencia
  ORDERS ||--o{ DELIVERY_ASSIGNMENTS : entrega
  DELIVERY_DRIVERS ||--o{ DELIVERY_ASSIGNMENTS : reparte
  BRANCHES ||--o{ ORDERS : despacha
```

## Diagramas de relaciones

Generados automáticamente desde las claves foráneas reales del esquema.
Cardinalidad: `||--o{` = uno-a-muchos, `||--||` = uno-a-uno. La etiqueta es la columna FK.

### Visión general por dominios

```mermaid
flowchart LR
  D0["Núcleo de catálogo"]
  D1["Impuestos y proveedores"]
  D2["Sucursales, inventario y precios"]
  D3["Clientes (B2C)"]
  D4["Usuarios y seguridad (admin)"]
  D5["Carrito y pedidos"]
  D6["Promociones y cupones"]
  D7["Entrega / delivery"]
  D8["Picking y listas"]
  D9["Contenido / CMS"]
  D10["Marketing y notificaciones"]
  D11["Infraestructura"]
  D12["Sistema (PostGIS)"]
  D4 -->|1| D3
  D9 -->|4| D4
  D2 -->|5| D0
  D2 -->|2| D9
  D0 -->|3| D9
  D5 -->|2| D0
  D5 -->|2| D2
  D5 -->|2| D6
  D5 -->|7| D3
  D5 -->|3| D7
  D6 -->|2| D3
  D6 -->|1| D5
  D7 -->|2| D5
  D7 -->|2| D3
  D7 -->|2| D2
  D7 -->|2| D4
  D8 -->|2| D3
  D8 -->|2| D0
  D9 -->|1| D0
  D2 -->|4| D4
  D5 -->|2| D9
  D10 -->|1| D3
  D5 -->|2| D4
  D8 -->|2| D4
  D1 -->|1| D4
  D1 -->|2| D0
  D6 -->|1| D0
  D6 -->|1| D4
  D5 -->|1| D1
```

Cada flecha indica cuántas claves foráneas cruzan de un dominio a otro.

### Núcleo de catálogo

```mermaid
erDiagram
  BRANDS ||--o{ PRODUCTS : brand_id
  PRODUCTS ||--o{ PRODUCT_VARIANTS : product_id
  MEDIA ||--o{ BRANDS : logo_media_id
  MEDIA ||--o{ CATEGORIES : image_media_id
  CATEGORIES ||--o{ CATEGORIES : parent_id
  CATEGORIES ||--o{ PRODUCT_CATEGORIES : category_id
  PRODUCTS ||--o{ PRODUCT_CATEGORIES : product_id
  MEDIA ||--o{ PRODUCT_TYPES : image_media_id
  PRODUCTS ||--o{ PRODUCT_TYPE_ASSIGNMENTS : product_id
  PRODUCT_TYPES ||--o{ PRODUCT_TYPE_ASSIGNMENTS : product_type_id
  ATTRIBUTES ||--o{ ATTRIBUTE_OPTIONS : attribute_id
  ATTRIBUTES ||--o{ VARIANT_ATTRIBUTES : attribute_id
  ATTRIBUTE_OPTIONS ||--o{ VARIANT_ATTRIBUTES : attribute_option_id
  PRODUCT_VARIANTS ||--o{ VARIANT_ATTRIBUTES : variant_id
  ATTRIBUTES ||--o{ PRODUCT_ATTRIBUTES : attribute_id
  ATTRIBUTE_OPTIONS ||--o{ PRODUCT_ATTRIBUTES : attribute_option_id
  PRODUCTS ||--o{ PRODUCT_ATTRIBUTES : product_id
```

### Impuestos y proveedores

```mermaid
erDiagram
  USERS ||--o{ PRODUCT_TAX_CLASSES : assigned_by
  PRODUCTS ||--o{ PRODUCT_TAX_CLASSES : product_id
  TAX_RATES ||--o{ PRODUCT_TAX_CLASSES : tax_rate_id
  PRODUCT_VARIANTS ||--o{ SUPPLIER_PRODUCTS : product_variant_id
  SUPPLIERS ||--o{ SUPPLIER_PRODUCTS : supplier_id
```

### Sucursales, inventario y precios

```mermaid
erDiagram
  MEDIA ||--o{ BRANCHES : image_media_id
  STORE ||--o{ BRANCHES : store_id
  BRANCHES ||--o{ BRANCH_PRODUCTS : branch_id
  PRODUCTS ||--o{ BRANCH_PRODUCTS : product_id
  BRANCHES ||--o{ INVENTORY : branch_id
  PRODUCT_VARIANTS ||--o{ INVENTORY : product_variant_id
  INVENTORY ||--o{ INVENTORY_MOVEMENTS : inventory_id
  USERS ||--o{ INVENTORY_MOVEMENTS : performed_by
  USERS ||--o{ INVENTORY_RESERVATIONS : created_by
  INVENTORY ||--o{ INVENTORY_RESERVATIONS : inventory_id
  BRANCHES ||--o{ PRICES : branch_id
  USERS ||--o{ PRICES : changed_by
  PRODUCT_VARIANTS ||--o{ PRICES : product_variant_id
  BRANCHES ||--o{ PRODUCT_LOCATIONS : branch_id
  PRODUCT_VARIANTS ||--o{ PRODUCT_LOCATIONS : product_variant_id
  SHELVES ||--o{ PRODUCT_LOCATIONS : shelf_id
  BRANCHES ||--o{ SHELVES : branch_id
  CATEGORIES ||--o{ SHELF_CATEGORIES : category_id
  SHELVES ||--o{ SHELF_CATEGORIES : shelf_id
  BRANCHES ||--o{ USER_BRANCHES : branch_id
  USERS ||--|| USER_BRANCHES : user_id
```

### Clientes (B2C)

```mermaid
erDiagram
  CUSTOMERS ||--o{ CUSTOMER_ADDRESSES : customer_id
  CUSTOMERS ||--o{ CUSTOMER_PAYMENT_METHODS : customer_id
  CUSTOMERS ||--o{ CUSTOMER_SESSIONS : customer_id
  CUSTOMERS ||--o{ CUSTOMER_REFRESH_TOKENS : customer_id
  CUSTOMERS ||--o{ CUSTOMER_TOKENS : customer_id
  CUSTOMERS ||--o{ GUEST_SESSIONS : converted_customer_id
```

### Usuarios y seguridad (admin)

```mermaid
erDiagram
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : permission_id
  ROLES ||--o{ ROLE_PERMISSIONS : role_id
  ROLES ||--o{ USER_ROLES : role_id
  USERS ||--o{ USER_ROLES : user_id
  USERS ||--o{ USER_SESSIONS : user_id
  USERS ||--o{ USER_REFRESH_TOKENS : user_id
  USERS ||--o{ AUDIT_LOGS : performed_by
  CUSTOMERS ||--o{ AUDIT_LOGS : performed_by_customer
```

### Carrito y pedidos

```mermaid
erDiagram
  BRANCHES ||--o{ CARTS : branch_id
  COUPONS ||--o{ CARTS : coupon_id
  CUSTOMER_ADDRESSES ||--o{ CARTS : customer_address_id
  CUSTOMERS ||--o{ CARTS : customer_id
  DELIVERY_ZONES ||--o{ CARTS : delivery_zone_id
  GUEST_SESSIONS ||--o{ CARTS : guest_session_id
  CARTS ||--o{ CART_ITEMS : cart_id
  PRODUCT_VARIANTS ||--o{ CART_ITEMS : product_variant_id
  BRANCHES ||--o{ ORDERS : branch_id
  COUPONS ||--o{ ORDERS : coupon_id
  CUSTOMER_ADDRESSES ||--o{ ORDERS : customer_address_id
  CUSTOMERS ||--o{ ORDERS : customer_id
  DELIVERY_ZONES ||--o{ ORDERS : delivery_zone_id
  GUEST_SESSIONS ||--o{ ORDERS : guest_session_id
  ORDERS ||--o{ ORDER_ITEMS : order_id
  PRODUCT_VARIANTS ||--o{ ORDER_ITEMS : product_variant_id
  CUSTOMERS ||--o{ ORDER_STATUS_HISTORY : created_by
  ORDERS ||--o{ ORDER_STATUS_HISTORY : order_id
  USERS ||--o{ ORDER_STATUS_HISTORY : picker_id
  ORDERS ||--|| INVOICES : order_id
  MEDIA ||--o{ INVOICES : pdf_media_id
  ORDERS ||--o{ PAYMENTS : order_id
  PAYMENT_INTENTS ||--o{ PAYMENTS : payment_intent_id
  ORDERS ||--|| PAYMENT_INTENTS : order_id
  ORDERS ||--o{ REFUNDS : order_id
  PAYMENTS ||--o{ REFUNDS : payment_id
  USERS ||--o{ REFUNDS : processed_by
  DELIVERY_TIME_SLOTS ||--o{ SHIPMENTS : delivery_time_slot_id
  ORDERS ||--|| SHIPMENTS : order_id
  TAX_RATES ||--o{ SHIPMENTS : shipping_tax_rate_id
```

### Promociones y cupones

```mermaid
erDiagram
  PROMOTIONS ||--o{ COUPONS : promotion_id
  COUPONS ||--o{ COUPON_REDEMPTIONS : coupon_id
  CUSTOMERS ||--o{ COUPON_REDEMPTIONS : customer_id
  GUEST_SESSIONS ||--o{ COUPON_REDEMPTIONS : guest_session_id
  ORDERS ||--o{ COUPON_REDEMPTIONS : order_id
  USERS ||--o{ PROMOTIONS : created_by
  PROMOTIONS ||--o{ PROMOTION_CONDITIONS : promotion_id
  PRODUCT_VARIANTS ||--o{ PROMOTION_PRODUCTS : product_variant_id
  PROMOTIONS ||--o{ PROMOTION_PRODUCTS : promotion_id
```

### Entrega / delivery

```mermaid
erDiagram
  DELIVERY_DRIVERS ||--o{ DELIVERY_ASSIGNMENTS : driver_id
  SHIPMENTS ||--o{ DELIVERY_ASSIGNMENTS : shipment_id
  DELIVERY_ASSIGNMENTS ||--o{ DELIVERY_EVENTS : assignment_id
  CUSTOMERS ||--o{ DELIVERY_EVENTS : created_by
  DELIVERY_DRIVERS ||--o{ DELIVERY_DRIVER_LOCATIONS : driver_id
  DELIVERY_ASSIGNMENTS ||--o{ DELIVERY_PROOF_MEDIA : assignment_id
  BRANCHES ||--o{ DELIVERY_ZONES : branch_id
  BRANCHES ||--o{ DELIVERY_TIME_SLOTS : branch_id
  DELIVERY_DRIVERS ||--o{ DRIVER_CHAT_MESSAGES : driver_id
  USERS ||--o{ DRIVER_CHAT_MESSAGES : sender_user_id
  ORDERS ||--o{ ORDER_CHAT_MESSAGES : order_id
  GUEST_SESSIONS ||--o{ ORDER_CHAT_MESSAGES : sender_guest_session_id
  USERS ||--o{ ORDER_CHAT_MESSAGES : sender_user_id
```

### Picking y listas

```mermaid
erDiagram
  USERS ||--o{ PICKER_CHAT_MESSAGES : picker_id
  CUSTOMERS ||--o{ SHOPPING_LISTS : customer_id
  SHOPPING_LISTS ||--o{ SHOPPING_LIST_ITEMS : list_id
  PRODUCTS ||--o{ SHOPPING_LIST_ITEMS : product_id
  CUSTOMERS ||--o{ FAVORITES : customer_id
  PRODUCTS ||--o{ FAVORITES : product_id
```

### Contenido / CMS

```mermaid
erDiagram
  SAVED_FILTERS ||--o{ BANNERS : filter_id
  MEDIA ||--o{ BANNERS : media_id
  USERS ||--o{ PAGES : created_by
  MENUS ||--o{ MENU_ITEMS : menu_id
  PAGES ||--o{ MENU_ITEMS : page_id
  MENU_ITEMS ||--o{ MENU_ITEMS : parent_id
  MEDIA ||--o{ POPUPS : image_media_id
  MEDIA ||--o{ STORE : logo_media_id
  USERS ||--o{ MEDIA : uploaded_by
  PRODUCTS ||--o{ FEATURED_PRODUCT_ASSIGNMENTS : product_id
  FEATURED_PRODUCT_TABS ||--o{ FEATURED_PRODUCT_ASSIGNMENTS : tab_id
```

### Marketing y notificaciones

```mermaid
erDiagram
  CUSTOMERS ||--o{ NOTIFICATIONS : target_customer_id
```

## Referencia de tablas

### Núcleo de catálogo

#### `products` — 21.613 filas

Producto padre (cabecera comercial). Agrupa variantes, categorías, tipos, atributos y medios. `external_id` guarda el código TID largo (15 díg.), `plu` el código corto.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('products_id_seq'::regclass) | PK |
| `brand_id` | bigint | sí |  | FK a la marca |
| `external_id` | varchar(50) | sí |  | Código externo/ERP. En TID es el código largo de 15 dígitos (`INARTIC`). |
| `name` | varchar(255) | no |  | Nombre del producto |
| `slug` | varchar(255) | no |  | Slug único para URL |
| `description` | text | sí |  | Descripción del producto (visible al cliente) |
| `product_type` | varchar(20) | no | 'SIMPLE' | Estructura del producto: SIMPLE o con VARIANTES (no confundir con la tabla `product_types`) |
| `sku_prefix` | varchar(50) | sí |  | Prefijo para generar SKUs |
| `plu` | varchar(20) | sí |  | PLU: código corto de caja/balanza (TID) |
| `featured` | boolean | no | false | Producto destacado |
| `manufacturer` | varchar(255) | sí |  | Fabricante |
| `visibility` | varchar(20) | no | 'PUBLIC' | Visibilidad (PUBLIC/PRIVATE…) |
| `is_public` | boolean | no | true | Visible públicamente |
| `is_active` | boolean | no | true | Indica si está activo |
| `published_at` | timestamp | sí |  | Fecha de publicación |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Claves foráneas:** `brand_id` → `brands.id` (ON DELETE RESTRICT)

**Índices:**
- `public.products USING btree (brand_id) WHERE (deleted_at IS NULL)`
- `UNIQUE public.products USING btree (external_id) WHERE ((external_id IS NOT NULL) AND (deleted_at IS NULL))`
- `public.products USING gin (to_tsvector('spanish'::regconfig, (((name)::text || ' '::text) || COALESCE(description, ''::text)))) WHERE ((is_active = true) AND (deleted_at IS NULL))`
- `UNIQUE public.products USING btree (slug) WHERE (deleted_at IS NULL)`
- `UNIQUE public.products USING btree (slug)`

#### `product_variants` — 21.613 filas

Variante vendible de un producto (SKU). Aquí viven `sku` (código TID largo) y `barcode` (EAN). Es lo que referencian precios, inventario y líneas de pedido.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('product_variants_id_seq'::regclass) | Identificador único (PK) |
| `product_id` | bigint | no |  | Producto padre |
| `sku` | varchar(100) | no |  | SKU único de la variante (código TID largo) |
| `barcode` | varchar(100) | sí |  | Código de barras EAN (`INEAN`) |
| `current_price` | numeric(12,2) | no | '0' | Precio de venta vigente (desnormalizado, referencia rápida) |
| `current_compare_price` | numeric(12,2) | sí |  | Precio “antes”/tachado para mostrar descuento |
| `length_mm` | integer | sí |  | Largo en mm (para volumen/rutas) |
| `width_mm` | integer | sí |  | Ancho en mm (para volumen/rutas) |
| `height_mm` | integer | sí |  | Alto en mm (para volumen/rutas) |
| `cost_price` | numeric(12,2) | sí |  | Costo unitario |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Claves foráneas:** `product_id` → `products.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.product_variants USING btree (barcode) WHERE (barcode IS NOT NULL)`
- `public.product_variants USING btree (current_price) WHERE ((is_active = true) AND (deleted_at IS NULL))`
- `UNIQUE public.product_variants USING btree (sku)`
- `UNIQUE public.product_variants USING btree (sku)`

#### `brands` — 2.569 filas

Marcas. En el catálogo TID la marca real proviene de `INMARCAP`.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('brands_id_seq'::regclass) | Identificador único (PK) |
| `website` | varchar(255) | no |  | Sitio web |
| `description` | text | no |  | Descripción |
| `country` | varchar(100) | no |  | País de origen |
| `name` | varchar(100) | no |  | Nombre de la marca |
| `slug` | varchar(100) | no |  | Slug único |
| `code` | varchar(50) | sí |  | Código de marca |
| `logo_media_id` | bigint | sí |  | FK a `media` con el logo |
| `is_public` | boolean | no | true | Visible en el catálogo |
| `is_featured` | boolean | no | false | Marca destacada |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Claves foráneas:** `logo_media_id` → `media.id` (ON DELETE SET NULL)

**Índices:**
- `UNIQUE public.brands USING btree (name)`
- `UNIQUE public.brands USING btree (slug)`
- `UNIQUE public.brands USING btree (slug) WHERE (deleted_at IS NULL)`

#### `categories` — 173 filas

Categorías de catálogo (árbol con `parent_id`).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('categories_id_seq'::regclass) | Identificador único (PK) |
| `parent_id` | bigint | sí |  | Categoría padre (auto-relación, árbol) |
| `name` | varchar(100) | no |  | Nombre de la categoría |
| `display_order` | integer | no | 0 | Orden de visualización |
| `slug` | varchar(100) | no |  | Slug único |
| `code` | varchar(50) | sí |  | Código de categoría |
| `description` | text | sí |  | Descripción |
| `image_media_id` | bigint | sí |  | FK a `media` con la imagen |
| `level` | integer | sí | 0 | Nivel en el árbol |
| `meta_title` | varchar(255) | sí |  | Título SEO |
| `meta_description` | text | sí |  | Descripción SEO |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Claves foráneas:** `image_media_id` → `media.id` (ON DELETE SET NULL); `parent_id` → `categories.id` (ON DELETE RESTRICT)

**Índices:**
- `UNIQUE public.categories USING btree (parent_id, name)`
- `UNIQUE public.categories USING btree (slug)`
- `public.categories USING btree (parent_id) WHERE (deleted_at IS NULL)`
- `UNIQUE public.categories USING btree (slug) WHERE (deleted_at IS NULL)`

#### `product_categories` — 21.613 filas

Relación N:M producto → categoría.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `product_id` | bigint | no |  | FK → `products.id` |
| `category_id` | bigint | no |  | FK → `categories.id` |

**Claves foráneas:** `category_id` → `categories.id` (ON DELETE CASCADE); `product_id` → `products.id` (ON DELETE CASCADE)

**Índices:**
- `public.product_categories USING btree (category_id)`

#### `product_types` — 367 filas

Tipos de producto (clasificación comercial/operativa).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('product_types_id_seq'::regclass) | Identificador único (PK) |
| `code` | varchar(10) | no |  | Código del tipo |
| `name` | varchar(100) | no |  | Nombre del tipo |
| `description` | text | sí |  | Descripción |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `image_media_id` | bigint | sí |  | FK a `media` con el ícono/imagen |

**Claves foráneas:** `image_media_id` → `media.id` (ON DELETE SET NULL)

**Índices:**
- `UNIQUE public.product_types USING btree (code)`

#### `product_type_assignments` — 21.611 filas

Relación N:M producto → tipo de producto.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `product_id` | bigint | no |  | FK → `products.id` |
| `product_type_id` | bigint | no |  | FK → `product_types.id` |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `product_id` → `products.id` (ON DELETE CASCADE); `product_type_id` → `product_types.id` (ON DELETE CASCADE)

#### `attributes` — 9 filas

Definición de atributos (color, talla, etc.).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('attributes_id_seq'::regclass) | Identificador único (PK) |
| `name` | varchar(100) | no |  | Nombre |
| `slug` | varchar(100) | no |  | Identificador legible para URL |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Índices:**
- `UNIQUE public.attributes USING btree (name)`
- `UNIQUE public.attributes USING btree (slug)`

#### `attribute_options` — 0 filas

Valores posibles de un atributo.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('attribute_options_id_seq'::regclass) | Identificador único (PK) |
| `attribute_id` | bigint | no |  | FK → `attributes.id` |
| `value` | varchar(100) | no |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `attribute_id` → `attributes.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.attribute_options USING btree (attribute_id, value)`

#### `variant_attributes` — 0 filas

Valores de atributo asignados a una variante.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('variant_attributes_id_seq'::regclass) | Identificador único (PK) |
| `variant_id` | bigint | no |  | FK → `product_variants.id` |
| `attribute_id` | bigint | no |  | FK → `attributes.id` |
| `attribute_option_id` | bigint | no |  | FK → `attribute_options.id` |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `attribute_id` → `attributes.id` (ON DELETE RESTRICT); `attribute_option_id` → `attribute_options.id` (ON DELETE RESTRICT); `variant_id` → `product_variants.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.variant_attributes USING btree (variant_id, attribute_id)`

#### `product_attributes` — 138.300 filas

Atributos a nivel de producto (p. ej. ficha técnica, dimensiones migradas del TID).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('product_attributes_id_seq'::regclass) | Identificador único (PK) |
| `product_id` | bigint | no |  | Producto |
| `attribute_id` | bigint | no |  | Atributo |
| `attribute_option_id` | bigint | sí |  | Opción del atributo |
| `custom_value` | varchar(255) | sí |  | Valor libre (si no es una opción predefinida) |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `attribute_id` → `attributes.id` (ON DELETE RESTRICT); `attribute_option_id` → `attribute_options.id` (ON DELETE RESTRICT); `product_id` → `products.id` (ON DELETE CASCADE)

### Impuestos y proveedores

#### `product_tax_classes` — 21.613 filas

Clase de impuesto por producto.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `priority` | smallint | sí | 1 |  |
| `assigned_at` | timestamptz | sí | now() |  |
| `assigned_by` | bigint | sí |  | FK → `users.id` |
| `product_id` | bigint | no |  | FK → `products.id` |
| `tax_rate_id` | bigint | no |  | FK → `tax_rates.id` |

**Claves foráneas:** `assigned_by` → `users.id`; `product_id` → `products.id` (ON DELETE CASCADE); `tax_rate_id` → `tax_rates.id` (ON DELETE RESTRICT)

#### `tax_rates` — 3 filas

Tarifas de impuesto (IVA, etc.).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('tax_rates_id_seq'::regclass) | Identificador único (PK) |
| `name` | varchar(50) | no |  | Nombre |
| `code` | varchar(30) | no |  |  |
| `description` | text | sí |  | Descripción |
| `priority` | smallint | no | 1 |  |
| `compound` | boolean | no | false |  |
| `valid_from` | date | sí |  |  |
| `country_code` | varchar(2) | sí |  |  |
| `state_code` | varchar(20) | sí |  |  |
| `city_code` | varchar(20) | sí |  |  |
| `valid_to` | date | sí |  |  |
| `rate` | numeric(5,2) | no |  |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `tax_type` | varchar(30) | no |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Índices:**
- `public.tax_rates USING btree (is_active)`
- `public.tax_rates USING btree (code)`
- `public.tax_rates USING btree (valid_from, valid_to)`
- `UNIQUE public.tax_rates USING btree (code)`

#### `suppliers` — 753 filas

Proveedores del catálogo TID (`INPROVEE`).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('suppliers_id_seq'::regclass) | Identificador único (PK) |
| `code` | varchar(30) | sí |  |  |
| `legal_name` | varchar(200) | no |  |  |
| `tax_id` | varchar(50) | sí |  |  |
| `contact_name` | varchar(100) | sí |  |  |
| `email` | varchar(255) | sí |  | Correo electrónico |
| `phone` | varchar(50) | sí |  | Teléfono |
| `address` | text | sí |  |  |
| `city` | varchar(100) | sí |  |  |
| `country` | varchar(100) | sí |  |  |
| `website` | varchar(255) | sí |  |  |
| `payment_terms_days` | integer | sí |  |  |
| `currency_code` | varchar(3) | sí |  |  |
| `notes` | text | sí |  |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Índices:**
- `public.suppliers USING btree (is_active)`
- `UNIQUE public.suppliers USING btree (code)`
- `UNIQUE public.suppliers USING btree (tax_id)`

#### `supplier_products` — 21.613 filas

Relación N:M proveedor → producto.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('supplier_products_id_seq'::regclass) | Identificador único (PK) |
| `supplier_id` | bigint | no |  | FK → `suppliers.id` |
| `product_variant_id` | bigint | no |  | FK → `product_variants.id` |
| `supplier_sku` | varchar(100) | sí |  |  |
| `purchase_price` | numeric(12,2) | sí |  |  |
| `lead_time_days` | integer | sí | 0 |  |
| `is_preferred` | boolean | no | false |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `product_variant_id` → `product_variants.id` (ON DELETE RESTRICT); `supplier_id` → `suppliers.id` (ON DELETE RESTRICT)

**Índices:**
- `public.supplier_products USING btree (is_preferred)`
- `public.supplier_products USING btree (supplier_id)`
- `public.supplier_products USING btree (product_variant_id)`
- `UNIQUE public.supplier_products USING btree (supplier_id, product_variant_id)`

### Sucursales, inventario y precios

#### `branches` — 10 filas

Sucursales / bodegas (empresa-tienda). Cada producto y precio puede variar por sucursal.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('branches_id_seq'::regclass) | Identificador único (PK) |
| `code` | varchar(20) | no |  | Código de sucursal |
| `name` | varchar(100) | no |  | Nombre de la sucursal |
| `address` | text | no |  | Dirección |
| `city` | varchar(100) | no |  | Ciudad |
| `phone` | varchar(50) | no |  | Teléfono |
| `store_id` | bigint | no |  | FK a `store` (empresa/tenant) |
| `email` | varchar(255) | no |  | Correo |
| `priority` | smallint | sí | 1 | Prioridad (desempate entre sucursales) |
| `manager_name` | varchar(150) | no |  | Nombre del encargado |
| `manager_phone` | varchar(30) | no |  | Teléfono del encargado |
| `max_daily_orders` | integer | sí |  | Máximo de pedidos diarios |
| `branch_type` | varchar(50) | sí | 'STORE' | Tipo de sucursal (tienda, bodega, etc.) |
| `location` | text | no |  | Ubicación geográfica (PostGIS geography/point) |
| `delivery_radius_km` | numeric(6,2) | no | 5.0 | Radio de entrega en km |
| `schedule` | jsonb | sí |  | Horario (JSON) |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |
| `image_media_id` | bigint | sí |  | FK a `media` con la imagen |
| `is_visible` | boolean | no | true | Visible en la app/tienda |

**Claves foráneas:** `image_media_id` → `media.id` (ON DELETE SET NULL); `store_id` → `store.id`

**Índices:**
- `UNIQUE public.branches USING btree (code)`
- `public.branches USING btree (location)`

#### `branch_products` — 51.938 filas

Disponibilidad de un producto en una sucursal (habilitado, destacado, etc.).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('branch_products_id_seq'::regclass) | Identificador único (PK) |
| `branch_id` | bigint | no |  | Sucursal |
| `product_id` | bigint | no |  | Producto |
| `is_available` | boolean | no | true | Disponible en la sucursal |
| `is_public` | boolean | no | true | Visible en la sucursal |
| `position` | integer | no | 0 | Orden dentro de la sucursal |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `branch_id` → `branches.id` (ON DELETE CASCADE); `product_id` → `products.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.branch_products USING btree (branch_id, product_id)`
- `public.branch_products USING btree (branch_id)`
- `public.branch_products USING btree (product_id)`

#### `inventory` — 51.938 filas

Existencia (stock) por variante y sucursal.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('inventory_id_seq'::regclass) | Identificador único (PK) |
| `product_variant_id` | bigint | no |  | Variante |
| `branch_id` | bigint | no |  | Sucursal |
| `stock` | integer | no | 0 | Existencia actual |
| `reserved_stock` | integer | no | 0 | Existencia reservada (pedidos en curso) |
| `reorder_point` | integer | no | 0 | Punto de reorden |
| `target_stock` | integer | sí |  | Stock objetivo |
| `last_movement_at` | timestamptz | sí |  | Fecha del último movimiento |
| `last_counted_at` | timestamptz | sí |  | Fecha del último conteo físico |
| `minimum_stock` | integer | sí | 0 | Stock mínimo |
| `maximum_stock` | integer | sí | 999999 | Stock máximo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `branch_id` → `branches.id` (ON DELETE RESTRICT); `product_variant_id` → `product_variants.id` (ON DELETE RESTRICT)

**Índices:**
- `public.inventory USING btree (branch_id)`
- `public.inventory USING btree (branch_id, stock) WHERE (stock > 0)`
- `public.inventory USING btree (reorder_point)`
- `public.inventory USING btree (branch_id, product_variant_id) WHERE (reserved_stock > 0)`
- `public.inventory USING btree (stock)`
- `UNIQUE public.inventory USING btree (product_variant_id, branch_id)`

#### `inventory_movements` — 0 filas

Movimientos/kardex de inventario (entradas, salidas, ajustes).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('inventory_movements_id_seq'::regclass) | Identificador único (PK) |
| `inventory_id` | bigint | no |  | FK → `inventory.id` |
| `movement_type` | USER-DEFINED | no |  |  |
| `quantity` | integer | no |  |  |
| `reference_type` | USER-DEFINED | no |  |  |
| `performed_by` | bigint | no |  | FK → `users.id` |
| `previous_stock` | integer | no |  |  |
| `new_stock` | integer | no |  |  |
| `unit_cost` | numeric(12,2) | sí |  |  |
| `external_reference` | varchar(100) | sí |  |  |
| `reference_id` | bigint | sí |  |  |
| `reason` | text | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `inventory_id` → `inventory.id` (ON DELETE RESTRICT); `performed_by` → `users.id`

**Índices:**
- `public.inventory_movements USING btree (created_at)`
- `public.inventory_movements USING btree (inventory_id)`
- `public.inventory_movements USING btree (reference_type, reference_id)`
- `public.inventory_movements USING btree (movement_type)`

#### `inventory_reservations` — 0 filas

Reservas de inventario mientras un pedido está en curso.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('inventory_reservations_id_seq'::regclass) | Identificador único (PK) |
| `inventory_id` | bigint | no |  | FK → `inventory.id` |
| `reference_type` | USER-DEFINED | sí | 'CART' |  |
| `reference_id` | bigint | no |  |  |
| `created_by` | bigint | sí |  | FK → `users.id` |
| `quantity` | integer | no |  |  |
| `released_quantity` | integer | no | 0 |  |
| `expires_at` | timestamptz | no | (now() + '00:15:00'::interval) | Fecha de expiración |
| `released_at` | timestamptz | sí |  |  |
| `status` | USER-DEFINED | no | 'active' | Estado del registro |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `created_by` → `users.id` (ON DELETE SET NULL); `inventory_id` → `inventory.id` (ON DELETE RESTRICT)

**Índices:**
- `public.inventory_reservations USING btree (expires_at)`
- `public.inventory_reservations USING btree (inventory_id)`
- `public.inventory_reservations USING btree (reference_type, reference_id)`
- `public.inventory_reservations USING btree (status)`
- `public.inventory_reservations USING btree (status, expires_at) WHERE (status = 'active'::reservation_status_enum)`

#### `prices` — 49.036 filas

Precios por variante, sucursal y lista de precio.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('prices_id_seq'::regclass) | Identificador único (PK) |
| `product_variant_id` | bigint | no |  | Variante |
| `start_date` | timestamptz | no | now() | Inicio de vigencia |
| `end_date` | timestamptz | sí |  | Fin de vigencia |
| `changed_by` | bigint | no |  | Usuario que cambió el precio |
| `change_reason` | varchar(100) | no |  | Motivo del cambio |
| `cost` | numeric(12,2) | sí |  | Costo de referencia |
| `price` | numeric(12,2) | no |  | Precio de venta |
| `compare_price` | numeric(12,2) | sí |  | Precio “antes”/tachado |
| `version` | integer | sí | 1 | Versión/lista de precio |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `branch_id` | bigint | sí |  | Sucursal (el precio varía por sucursal) |

**Claves foráneas:** `branch_id` → `branches.id` (ON DELETE RESTRICT); `changed_by` → `users.id`; `product_variant_id` → `product_variants.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.prices USING btree (product_variant_id, branch_id) WHERE ((end_date IS NULL) AND (branch_id IS NOT NULL))`
- `UNIQUE public.prices USING btree (product_variant_id) WHERE ((end_date IS NULL) AND (branch_id IS NULL))`

#### `product_locations` — 0 filas

Ubicación física del producto dentro de una bodega.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('product_locations_id_seq'::regclass) | Identificador único (PK) |
| `product_variant_id` | bigint | no |  | FK → `product_variants.id` |
| `branch_id` | bigint | no |  | FK → `branches.id` |
| `shelf_id` | bigint | no |  | FK → `shelves.id` |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `branch_id` → `branches.id` (ON DELETE CASCADE); `product_variant_id` → `product_variants.id` (ON DELETE CASCADE); `shelf_id` → `shelves.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.product_locations USING btree (product_variant_id, branch_id)`

#### `shelves` — 41 filas

Estantes / góndolas de una bodega.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('shelves_id_seq'::regclass) | Identificador único (PK) |
| `branch_id` | bigint | no |  | FK → `branches.id` |
| `code` | varchar(20) | no |  |  |
| `name` | varchar(100) | no |  | Nombre |
| `type` | varchar(10) | no | 'center' |  |
| `color` | varchar(20) | no | '#F59E0B' |  |
| `width` | integer | no | 3 |  |
| `height` | integer | no | 4 |  |
| `pos_x` | integer | no | 0 |  |
| `pos_y` | integer | no | 0 |  |
| `rotation` | integer | no | 0 |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `branch_id` → `branches.id` (ON DELETE CASCADE)

#### `shelf_categories` — 181 filas

Relación estante → categoría.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `shelf_id` | bigint | no |  | FK → `shelves.id` |
| `category_id` | bigint | no |  | FK → `categories.id` |

**Claves foráneas:** `category_id` → `categories.id` (ON DELETE CASCADE); `shelf_id` → `shelves.id` (ON DELETE CASCADE)

#### `user_branches` — 8 filas

Sucursales asignadas a un usuario.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `user_id` | bigint | no |  | FK → `users.id` |
| `branch_id` | bigint | no |  | FK → `branches.id` |

**Claves foráneas:** `branch_id` → `branches.id` (ON DELETE CASCADE); `user_id` → `users.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.user_branches USING btree (user_id)`

### Clientes (B2C)

#### `customers` — 44 filas

Clientes B2C (compradores).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('customers_id_seq'::regclass) | Identificador único (PK) |
| `email` | text | no |  | Correo (login) |
| `password_hash` | varchar(255) | sí |  | Hash de contraseña |
| `document_number` | varchar(50) | sí |  | Número de documento |
| `document_type` | varchar(20) | sí |  | Tipo de documento |
| `first_name` | varchar(100) | sí |  | Nombres |
| `last_name` | varchar(100) | sí |  | Apellidos |
| `phone` | varchar(50) | sí |  | Teléfono |
| `birth_date` | date | sí |  | Fecha de nacimiento |
| `gender` | varchar(20) | sí |  | Género |
| `customer_type` | USER-DEFINED | no | 'registered' | Tipo de cliente |
| `preferred_language` | varchar(10) | sí | 'es' | Idioma preferido |
| `accepts_marketing` | boolean | no | false | Acepta marketing |
| `accepts_terms_at` | timestamptz | sí |  | Fecha de aceptación de términos |
| `is_verified` | boolean | no | false | Verificado |
| `last_activity_at` | timestamptz | sí |  | Última actividad |
| `last_login_at` | timestamptz | sí |  | Último inicio de sesión |
| `is_active` | boolean | no | true | Indica si está activo |
| `provider` | varchar(50) | sí |  | Proveedor de identidad |
| `provider_id` | varchar(255) | sí |  | ID en el proveedor de identidad |
| `avatar_url` | text | sí |  | URL del avatar |
| `email_verified` | boolean | sí | false | Correo verificado |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |
| `push_token` | text | sí |  | Token de notificaciones push |

**Índices:**
- `UNIQUE public.customers USING btree (email)`
- `public.customers USING btree (is_active)`
- `public.customers USING btree (last_activity_at)`
- `public.customers USING btree (provider)`
- `public.customers USING btree (provider_id)`
- `UNIQUE public.customers USING btree (provider, provider_id) WHERE (provider_id IS NOT NULL)`

#### `customer_addresses` — 6 filas

Direcciones de los clientes.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('customer_addresses_id_seq'::regclass) | Identificador único (PK) |
| `customer_id` | bigint | no |  | FK → `customers.id` |
| `alias` | varchar(50) | sí |  |  |
| `address_line1` | text | no |  |  |
| `address_line2` | text | sí |  |  |
| `city` | varchar(100) | no |  |  |
| `state` | varchar(100) | sí |  |  |
| `postal_code` | varchar(20) | sí |  |  |
| `country` | varchar(100) | no | 'Colombia' |  |
| `delivery_instructions` | text | sí |  |  |
| `location` | text | sí |  |  |
| `reference` | text | sí |  |  |
| `is_default` | boolean | no | false |  |
| `label_color` | varchar(20) | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Claves foráneas:** `customer_id` → `customers.id` (ON DELETE CASCADE)

**Índices:**
- `public.customer_addresses USING btree (customer_id, is_default)`
- `public.customer_addresses USING btree (location)`
- `UNIQUE public.customer_addresses USING btree (customer_id) WHERE (is_default = true)`

#### `customer_payment_methods` — 1 filas

Métodos de pago guardados por el cliente.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('customer_payment_methods_id_seq'::regclass) | Identificador único (PK) |
| `customer_id` | bigint | no |  | FK → `customers.id` |
| `method_type` | USER-DEFINED | no |  |  |
| `label` | varchar(50) | sí |  |  |
| `brand` | varchar(50) | sí |  |  |
| `last4` | varchar(4) | sí |  |  |
| `cardholder_name` | varchar(100) | sí |  |  |
| `token` | varchar(255) | sí |  |  |
| `phone` | varchar(20) | sí |  | Teléfono |
| `is_default` | boolean | no | false |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Claves foráneas:** `customer_id` → `customers.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.customer_payment_methods USING btree (customer_id) WHERE (is_default = true)`
- `public.customer_payment_methods USING btree (customer_id)`

#### `customer_sessions` — 0 filas

Sesiones activas de clientes.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('customer_sessions_id_seq'::regclass) | Identificador único (PK) |
| `customer_id` | bigint | no |  | FK → `customers.id` |
| `session_token` | uuid | no | uuid_generate_v4() |  |
| `ip_address` | inet | sí |  |  |
| `revoked_at` | timestamptz | sí |  |  |
| `device_name` | varchar(100) | sí |  |  |
| `user_agent` | text | sí |  |  |
| `expires_at` | timestamptz | no | (now() + '30 days'::interval) | Fecha de expiración |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `customer_id` → `customers.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.customer_sessions USING btree (session_token)`
- `public.customer_sessions USING btree (customer_id)`
- `public.customer_sessions USING btree (expires_at)`

#### `customer_refresh_tokens` — 18 filas

Tokens de refresco de autenticación de clientes.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('customer_refresh_tokens_id_seq'::regclass) | Identificador único (PK) |
| `customer_id` | bigint | no |  | FK → `customers.id` |
| `token` | text | no |  |  |
| `expires_at` | timestamptz | no |  | Fecha de expiración |
| `revoked` | boolean | no | false |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `customer_id` → `customers.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.customer_refresh_tokens USING btree (token)`
- `public.customer_refresh_tokens USING btree (customer_id)`
- `public.customer_refresh_tokens USING btree (expires_at)`
- `public.customer_refresh_tokens USING btree (token)`

#### `customer_tokens` — 0 filas

Tokens de un solo uso (verificación de correo, recuperación, etc.).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('customer_tokens_id_seq'::regclass) | Identificador único (PK) |
| `customer_id` | bigint | no |  | FK → `customers.id` |
| `token` | uuid | no | uuid_generate_v4() |  |
| `purpose` | USER-DEFINED | no |  |  |
| `consumed_ip` | inet | sí |  |  |
| `created_ip` | inet | sí |  |  |
| `expires_at` | timestamptz | no | (now() + '01:00:00'::interval) | Fecha de expiración |
| `used_at` | timestamptz | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `customer_id` → `customers.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.customer_tokens USING btree (token)`
- `public.customer_tokens USING btree (customer_id)`
- `public.customer_tokens USING btree (expires_at)`
- `public.customer_tokens USING btree (purpose)`

#### `guest_sessions` — 12 filas

Sesiones de invitados (carrito sin registro).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('guest_sessions_id_seq'::regclass) | Identificador único (PK) |
| `converted_customer_id` | bigint | sí |  | FK → `customers.id` |
| `session_token` | uuid | no | uuid_generate_v4() |  |
| `ip_address` | inet | sí |  |  |
| `user_agent` | text | sí |  |  |
| `last_activity_at` | timestamptz | no | now() |  |
| `expires_at` | timestamptz | no | (now() + '30 days'::interval) | Fecha de expiración |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `converted_customer_id` → `customers.id` (ON DELETE SET NULL)

**Índices:**
- `UNIQUE public.guest_sessions USING btree (session_token)`
- `public.guest_sessions USING btree (expires_at)`
- `public.guest_sessions USING btree (last_activity_at)`

### Usuarios y seguridad (admin)

#### `users` — 9 filas

Usuarios administrativos/operativos (admin, picker, delivery).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('users_id_seq'::regclass) | Identificador único (PK) |
| `email` | varchar(255) | no |  | Correo electrónico |
| `username` | varchar(50) | no |  |  |
| `locked_until` | timestamptz | sí |  |  |
| `filed_attempts` | bigint | no | 0 |  |
| `password_hash` | varchar(255) | no |  | Hash de contraseña |
| `first_name` | varchar(100) | no |  |  |
| `last_name` | varchar(100) | no |  |  |
| `phone` | varchar(50) | sí |  | Teléfono |
| `is_superuser` | boolean | no | false |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `last_login_at` | timestamptz | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |
| `is_picker` | boolean | no | false |  |
| `avatar_url` | text | sí |  |  |
| `push_token` | text | sí |  |  |

**Índices:**
- `public.users USING btree (email) WHERE (deleted_at IS NULL)`
- `UNIQUE public.users USING btree (email)`

#### `roles` — 4 filas

Roles del sistema.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('roles_id_seq'::regclass) | Identificador único (PK) |
| `name` | varchar(100) | no |  | Nombre |
| `description` | text | sí |  | Descripción |
| `is_system` | boolean | no | false |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Índices:**
- `UNIQUE public.roles USING btree (name)`

#### `permissions` — 22 filas

Permisos atómicos del sistema.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('permissions_id_seq'::regclass) | Identificador único (PK) |
| `code` | varchar(100) | no |  |  |
| `module` | varchar(100) | no |  |  |
| `description` | text | sí |  | Descripción |

**Índices:**
- `public.permissions USING btree (module)`
- `UNIQUE public.permissions USING btree (code)`

#### `role_permissions` — 34 filas

Permisos asignados a un rol.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `role_id` | bigint | no |  | FK → `roles.id` |
| `permission_id` | bigint | no |  | FK → `permissions.id` |

**Claves foráneas:** `permission_id` → `permissions.id` (ON DELETE CASCADE); `role_id` → `roles.id` (ON DELETE CASCADE)

**Índices:**
- `public.role_permissions USING btree (role_id)`

#### `user_roles` — 3 filas

Roles asignados a un usuario.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `user_id` | bigint | no |  | FK → `users.id` |
| `role_id` | bigint | no |  | FK → `roles.id` |

**Claves foráneas:** `role_id` → `roles.id` (ON DELETE CASCADE); `user_id` → `users.id` (ON DELETE CASCADE)

**Índices:**
- `public.user_roles USING btree (role_id)`
- `public.user_roles USING btree (user_id)`

#### `user_sessions` — 0 filas

Sesiones activas de usuarios administrativos.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('user_sessions_id_seq'::regclass) | Identificador único (PK) |
| `user_id` | bigint | no |  | FK → `users.id` |
| `session_token` | uuid | no | uuid_generate_v4() |  |
| `ip_address` | inet | sí |  |  |
| `user_agent` | text | sí |  |  |
| `expires_at` | timestamptz | no |  | Fecha de expiración |
| `last_activity_at` | timestamptz | no | now() |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `user_id` → `users.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.user_sessions USING btree (session_token)`

#### `user_refresh_tokens` — 210 filas

Tokens de refresco de usuarios administrativos.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('user_refresh_tokens_id_seq'::regclass) | Identificador único (PK) |
| `user_id` | bigint | no |  | FK → `users.id` |
| `token` | text | no |  |  |
| `expires_at` | timestamptz | no |  | Fecha de expiración |
| `revoked` | boolean | no | false |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `user_id` → `users.id` (ON DELETE CASCADE)

**Índices:**
- `public.user_refresh_tokens USING btree (expires_at)`
- `public.user_refresh_tokens USING btree (token)`
- `public.user_refresh_tokens USING btree (user_id)`
- `UNIQUE public.user_refresh_tokens USING btree (token)`

#### `audit_logs` — 0 filas

Registro de auditoría de acciones.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('audit_logs_id_seq'::regclass) | Identificador único (PK) |
| `table_name` | varchar(100) | no |  |  |
| `record_id` | bigint | no |  |  |
| `action` | USER-DEFINED | no |  |  |
| `old_data` | jsonb | sí |  |  |
| `new_data` | jsonb | sí |  |  |
| `performed_by` | bigint | sí |  | FK → `users.id` |
| `request_id` | uuid | sí |  |  |
| `user_agent` | text | sí |  |  |
| `changed_fields` | jsonb | sí |  |  |
| `performed_by_customer` | bigint | sí |  | FK → `customers.id` |
| `ip_address` | inet | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `performed_by` → `users.id`; `performed_by_customer` → `customers.id` (ON DELETE SET NULL)

**Índices:**
- `public.audit_logs USING btree (created_at)`
- `public.audit_logs USING btree (table_name, record_id)`
- `public.audit_logs USING btree (table_name)`
- `public.audit_logs USING btree (performed_by)`

#### `saved_filters` — 7 filas

Filtros guardados por usuario en el panel.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('saved_filters_id_seq'::regclass) | Identificador único (PK) |
| `name` | varchar(100) | no |  | Nombre |
| `description` | text | sí |  | Descripción |
| `category_ids` | jsonb | no | '[]' |  |
| `brand_id` | bigint | sí |  |  |
| `product_type_code` | varchar(50) | sí |  |  |
| `on_sale` | boolean | sí | false |  |
| `search` | varchar(200) | sí |  |  |
| `sort` | varchar(50) | sí |  |  |
| `price_min` | integer | sí |  |  |
| `price_max` | integer | sí |  |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `product_ids` | jsonb | no | '[]' |  |

**Índices:**
- `public.saved_filters USING btree (is_active)`

#### `settings` — 6 filas

Configuración clave/valor del sistema.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('settings_id_seq'::regclass) | Identificador único (PK) |
| `key` | varchar(100) | no |  |  |
| `value` | jsonb | no |  |  |
| `description` | text | sí |  | Descripción |
| `data_type` | varchar(20) | no |  |  |
| `is_editable` | boolean | no | true |  |
| `is_public` | boolean | no | false |  |
| `module` | varchar(50) | no |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Índices:**
- `UNIQUE public.settings USING btree (key)`

### Carrito y pedidos

#### `carts` — 8 filas

Carrito de compras (de cliente o invitado).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('carts_id_seq'::regclass) | Identificador único (PK) |
| `coupon_id` | bigint | sí |  | FK → `coupons.id` |
| `customer_id` | bigint | sí |  | FK → `customers.id` |
| `guest_session_id` | bigint | sí |  | FK → `guest_sessions.id` |
| `branch_id` | bigint | sí |  | FK → `branches.id` |
| `delivery_zone_id` | bigint | sí |  | FK → `delivery_zones.id` |
| `customer_address_id` | bigint | sí |  | FK → `customer_addresses.id` |
| `last_activity_at` | timestamptz | no | now() |  |
| `expires_at` | timestamptz | no | (now() + '7 days'::interval) | Fecha de expiración |
| `status` | USER-DEFINED | no | 'ACTIVE' | Estado del registro |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `branch_id` → `branches.id` (ON DELETE RESTRICT); `coupon_id` → `coupons.id` (ON DELETE SET NULL); `customer_address_id` → `customer_addresses.id` (ON DELETE SET NULL); `customer_id` → `customers.id` (ON DELETE CASCADE); `delivery_zone_id` → `delivery_zones.id` (ON DELETE RESTRICT); `guest_session_id` → `guest_sessions.id` (ON DELETE CASCADE)

**Índices:**
- `public.carts USING btree (customer_id)`
- `public.carts USING btree (guest_session_id)`
- `public.carts USING btree (last_activity_at)`
- `public.carts USING btree (status)`
- `UNIQUE public.carts USING btree (customer_id) WHERE (status = 'ACTIVE'::cart_status_enum)`
- `UNIQUE public.carts USING btree (guest_session_id) WHERE (status = 'ACTIVE'::cart_status_enum)`

#### `cart_items` — 51 filas

Líneas del carrito.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('cart_items_id_seq'::regclass) | Identificador único (PK) |
| `discount_amount` | numeric(12,2) | no | '0' |  |
| `tax_amount` | numeric(12,2) | no | '0' |  |
| `cart_id` | bigint | no |  | FK → `carts.id` |
| `subtotal` | numeric(12,2) | no |  |  |
| `product_variant_id` | bigint | no |  | FK → `product_variants.id` |
| `quantity` | integer | no |  |  |
| `unit_price` | numeric(12,2) | no |  |  |
| `metadata` | jsonb | sí |  | Datos adicionales en JSON |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `cart_id` → `carts.id` (ON DELETE CASCADE); `product_variant_id` → `product_variants.id` (ON DELETE RESTRICT)

**Índices:**
- `UNIQUE public.cart_items USING btree (cart_id, product_variant_id)`
- `public.cart_items USING btree (cart_id)`
- `public.cart_items USING btree (product_variant_id)`

#### `orders` — 98 filas

Pedidos. Núcleo transaccional; referencia cliente, sucursal, entrega y estado.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('orders_id_seq'::regclass) | Identificador único (PK) |
| `reference_code` | varchar(20) | no |  | Código de pedido mostrado al cliente |
| `customer_id` | bigint | sí |  | Cliente que compra |
| `guest_session_id` | bigint | sí |  | Sesión de invitado (si no hay registro) |
| `branch_id` | bigint | no |  | Sucursal que despacha |
| `delivery_zone_id` | bigint | sí |  | Zona de entrega |
| `customer_address_id` | bigint | sí |  | Dirección de entrega |
| `status` | USER-DEFINED | no | 'created' | Estado del pedido |
| `currency_code` | varchar(3) | no | 'COP' | Moneda |
| `exchange_rate` | numeric(12,6) | sí | 1.0 | Tasa de cambio |
| `subtotal` | numeric(12,2) | no | '0' | Subtotal |
| `discount_total` | numeric(12,2) | no | '0' | Total descuentos |
| `tax_total` | numeric(12,2) | no | '0' | Total impuestos |
| `shipping_cost` | numeric(12,2) | no | '0' | Costo de envío |
| `shipping_tax` | numeric(12,2) | no | '0' | Impuesto del envío |
| `grand_total` | numeric(12,2) | no | '0' | Total a pagar |
| `customer_ip` | inet | sí |  | IP del cliente |
| `coupon_id` | bigint | sí |  | Cupón aplicado |
| `user_agent` | text | sí |  | User-Agent del navegador |
| `notes` | text | sí |  | Notas del cliente |
| `internal_notes` | text | sí |  | Notas internas |
| `reviewed_at` | timestamptz | sí |  | Fecha de revisión |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `customer_name` | varchar(150) | sí |  | Nombre del cliente (snapshot) |
| `customer_phone` | varchar(30) | sí |  | Teléfono (snapshot) |
| `customer_email` | varchar(255) | sí |  | Correo (snapshot) |
| `picker_id` | bigint | sí |  | Picker que armó el pedido |
| `picked_at` | timestamptz | sí |  | Fecha de armado |
| `completed_at` | timestamptz | sí |  | Fecha de finalización |

**Claves foráneas:** `branch_id` → `branches.id` (ON DELETE RESTRICT); `coupon_id` → `coupons.id` (ON DELETE SET NULL); `customer_address_id` → `customer_addresses.id` (ON DELETE SET NULL); `customer_id` → `customers.id` (ON DELETE RESTRICT); `delivery_zone_id` → `delivery_zones.id` (ON DELETE RESTRICT); `guest_session_id` → `guest_sessions.id` (ON DELETE RESTRICT)

**Índices:**
- `public.orders USING btree (branch_id)`
- `public.orders USING btree (customer_id)`
- `public.orders USING btree (customer_id, status)`
- `public.orders USING btree (reference_code)`
- `public.orders USING btree (status)`
- `public.orders USING btree (status, created_at)`
- `UNIQUE public.orders USING btree (reference_code)`

#### `order_items` — 242 filas

Líneas del pedido (variante, cantidad, precio, impuestos).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('order_items_id_seq'::regclass) | Identificador único (PK) |
| `tax_name` | varchar(100) | sí |  | Nombre del impuesto |
| `order_id` | bigint | no |  | Pedido |
| `product_variant_id` | bigint | sí |  | Variante |
| `product_name` | varchar(255) | no |  | Nombre del producto (snapshot) |
| `variant_sku` | varchar(100) | sí |  | SKU (snapshot) |
| `quantity` | integer | no |  | Cantidad |
| `unit_price_net` | numeric(12,2) | no |  | Precio unitario sin impuesto |
| `unit_price_gross` | numeric(12,2) | no |  | Precio unitario con impuesto |
| `discount_amount` | numeric(12,2) | sí | '0' | Descuento |
| `tax_amount` | numeric(12,2) | sí | '0' | Impuesto |
| `subtotal` | numeric(12,2) | no |  | Subtotal de la línea |
| `tax_rate` | numeric(5,2) | sí | '0' | Tarifa de impuesto |
| `total` | numeric(12,2) | no |  | Total de la línea |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `picked_qty` | integer | no | 0 | Cantidad realmente alistada |

**Claves foráneas:** `order_id` → `orders.id` (ON DELETE CASCADE); `product_variant_id` → `product_variants.id` (ON DELETE RESTRICT)

#### `order_status_history` — 576 filas

Historial de cambios de estado de un pedido.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('order_status_history_id_seq'::regclass) | Identificador único (PK) |
| `order_id` | bigint | no |  | FK → `orders.id` |
| `status` | USER-DEFINED | no |  | Estado del registro |
| `note` | text | sí |  |  |
| `old_status` | USER-DEFINED | sí |  |  |
| `created_by` | bigint | sí |  | FK → `customers.id` |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `picker_id` | bigint | sí |  | FK → `users.id` |

**Claves foráneas:** `created_by` → `customers.id` (ON DELETE SET NULL); `order_id` → `orders.id` (ON DELETE CASCADE); `picker_id` → `users.id` (ON DELETE SET NULL)

**Índices:**
- `public.order_status_history USING btree (order_id)`

#### `invoices` — 0 filas

Facturas generadas para pedidos.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('invoices_id_seq'::regclass) | Identificador único (PK) |
| `order_id` | bigint | no |  | FK → `orders.id` |
| `invoice_number` | varchar(50) | no |  |  |
| `issued_at` | timestamptz | sí |  |  |
| `provider_name` | varchar(100) | sí |  |  |
| `provider_invoice_id` | varchar(100) | sí |  |  |
| `xml_media_id` | bigint | sí |  | FK a `media` |
| `pdf_media_id` | bigint | sí |  | FK a `media` |
| `cufe_code` | varchar(100) | sí |  |  |
| `status` | USER-DEFINED | sí | 'pending' | Estado del registro |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `order_id` → `orders.id` (ON DELETE RESTRICT); `pdf_media_id` → `media.id` (ON DELETE SET NULL); `xml_media_id` → `media.id` (ON DELETE SET NULL)

**Índices:**
- `UNIQUE public.invoices USING btree (invoice_number)`
- `UNIQUE public.invoices USING btree (order_id)`

#### `payments` — 98 filas

Pagos realizados sobre un pedido.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('payments_id_seq'::regclass) | Identificador único (PK) |
| `order_id` | bigint | no |  | FK → `orders.id` |
| `payment_intent_id` | bigint | sí |  | FK → `payment_intents.id` |
| `provider_transaction_id` | varchar(255) | no |  |  |
| `provider_name` | varchar(100) | sí |  |  |
| `authorization_code` | varchar(100) | sí |  |  |
| `provider_response` | jsonb | sí |  |  |
| `amount` | numeric(12,2) | no |  |  |
| `currency` | varchar(3) | no | 'COP' |  |
| `payment_method` | USER-DEFINED | no |  |  |
| `installments` | integer | sí | 1 |  |
| `status` | USER-DEFINED | sí | 'PENDING' | Estado del registro |
| `paid_at` | timestamptz | no | now() |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `order_id` → `orders.id` (ON DELETE RESTRICT); `payment_intent_id` → `payment_intents.id` (ON DELETE RESTRICT)

**Índices:**
- `public.payments USING btree (order_id)`
- `public.payments USING btree (payment_intent_id)`
- `UNIQUE public.payments USING btree (provider_transaction_id)`

#### `payment_intents` — 2 filas

Intenciones de pago (pasarela).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('payment_intents_id_seq'::regclass) | Identificador único (PK) |
| `order_id` | bigint | no |  | FK → `orders.id` |
| `payment_method` | USER-DEFINED | no |  |  |
| `status` | USER-DEFINED | no | 'created' | Estado del registro |
| `amount` | numeric(12,2) | no |  |  |
| `currency` | varchar(3) | no | 'COP' |  |
| `provider_transaction_id` | varchar(255) | sí |  |  |
| `provider_response` | jsonb | sí |  |  |
| `idempotency_key` | varchar(100) | sí |  |  |
| `customer_ip` | inet | sí |  |  |
| `provider_name` | varchar(100) | sí |  |  |
| `user_agent` | text | sí |  |  |
| `expires_at` | timestamptz | sí |  | Fecha de expiración |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `order_id` → `orders.id` (ON DELETE CASCADE)

**Índices:**
- `public.payment_intents USING btree (provider_transaction_id) WHERE (provider_transaction_id IS NOT NULL)`
- `public.payment_intents USING btree (order_id, status) WHERE (status = ANY (ARRAY['pending'::payment_intent_status_enum, 'created'::payment_intent_status_enum]))`
- `public.payment_intents USING btree (status)`
- `UNIQUE public.payment_intents USING btree (idempotency_key)`
- `UNIQUE public.payment_intents USING btree (order_id)`

#### `refunds` — 0 filas

Reembolsos/devoluciones.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('refunds_id_seq'::regclass) | Identificador único (PK) |
| `payment_id` | bigint | no |  | FK → `payments.id` |
| `order_id` | bigint | no |  | FK → `orders.id` |
| `amount` | numeric(12,2) | no |  |  |
| `reason` | text | sí |  |  |
| `provider_response` | jsonb | sí |  |  |
| `processed_by` | bigint | sí |  | FK → `users.id` |
| `status` | USER-DEFINED | no | 'pending' | Estado del registro |
| `provider_refund_id` | varchar(255) | sí |  |  |
| `processed_at` | timestamptz | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `order_id` → `orders.id` (ON DELETE RESTRICT); `payment_id` → `payments.id` (ON DELETE RESTRICT); `processed_by` → `users.id`

**Índices:**
- `public.refunds USING btree (payment_id)`

#### `shipments` — 66 filas

Envíos asociados a pedidos.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('shipments_id_seq'::regclass) | Identificador único (PK) |
| `order_id` | bigint | no |  | FK → `orders.id` |
| `address_line1` | text | no |  |  |
| `address_line2` | text | sí |  |  |
| `city` | varchar(100) | no |  |  |
| `postal_code` | varchar(20) | sí |  |  |
| `location` | text | sí |  |  |
| `delivery_time_slot_id` | bigint | sí |  | FK → `delivery_time_slots.id` |
| `scheduled_date` | date | sí |  |  |
| `carrier_name` | varchar(100) | sí |  |  |
| `tracking_number` | varchar(100) | sí |  |  |
| `tracking_url` | text | sí |  |  |
| `carrier_reference` | varchar(100) | sí |  |  |
| `estimated_delivery_at` | timestamptz | sí |  |  |
| `delivered_at` | timestamptz | sí |  |  |
| `recipient_name` | varchar(200) | sí |  |  |
| `recipient_phone` | varchar(50) | sí |  |  |
| `shipping_tax_rate_id` | bigint | sí |  | FK → `tax_rates.id` |
| `shipping_tax_amount` | numeric(12,2) | sí | '0' |  |
| `status` | USER-DEFINED | sí | 'PENDING' | Estado del registro |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `total_volume_cm3` | integer | sí |  |  |
| `volume_estimated` | boolean | no | false |  |

**Claves foráneas:** `delivery_time_slot_id` → `delivery_time_slots.id` (ON DELETE RESTRICT); `order_id` → `orders.id` (ON DELETE CASCADE); `shipping_tax_rate_id` → `tax_rates.id` (ON DELETE RESTRICT)

**Índices:**
- `public.shipments USING btree (location)`
- `UNIQUE public.shipments USING btree (order_id)`

### Promociones y cupones

#### `coupons` — 0 filas

Cupones de descuento.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('coupons_id_seq'::regclass) | Identificador único (PK) |
| `promotion_id` | bigint | no |  | FK → `promotions.id` |
| `code` | varchar(50) | no |  |  |
| `max_uses_total` | integer | sí | 1 |  |
| `starts_at` | timestamptz | sí |  |  |
| `expires_at` | timestamptz | sí |  | Fecha de expiración |
| `times_used` | integer | no | 0 |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `max_uses_per_customer` | integer | sí | 1 |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `promotion_id` → `promotions.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.coupons USING btree (code)`
- `public.coupons USING btree (is_active)`
- `public.coupons USING btree (code)`

#### `coupon_redemptions` — 0 filas

Uso/redención de cupones.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('coupon_redemptions_id_seq'::regclass) | Identificador único (PK) |
| `discount_amount` | numeric(12,2) | sí |  |  |
| `ip_address` | inet | sí |  |  |
| `guest_session_id` | bigint | sí |  | FK → `guest_sessions.id` |
| `coupon_id` | bigint | no |  | FK → `coupons.id` |
| `customer_id` | bigint | sí |  | FK → `customers.id` |
| `order_id` | bigint | sí |  | FK → `orders.id` |
| `used_at` | timestamptz | no | now() |  |

**Claves foráneas:** `coupon_id` → `coupons.id` (ON DELETE CASCADE); `customer_id` → `customers.id` (ON DELETE SET NULL); `guest_session_id` → `guest_sessions.id` (ON DELETE SET NULL); `order_id` → `orders.id` (ON DELETE SET NULL)

**Índices:**
- `public.coupon_redemptions USING btree (coupon_id)`
- `public.coupon_redemptions USING btree (customer_id)`
- `public.coupon_redemptions USING btree (order_id)`

#### `promotions` — 0 filas

Promociones comerciales.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('promotions_id_seq'::regclass) | Identificador único (PK) |
| `name` | varchar(100) | no |  | Nombre |
| `description` | text | sí |  | Descripción |
| `is_auto_apply` | boolean | no | false |  |
| `requires_code` | boolean | no | false |  |
| `priority` | integer | sí | 0 |  |
| `stackable` | boolean | no | false |  |
| `exclusive` | boolean | no | false |  |
| `usage_limit` | integer | sí |  |  |
| `times_used` | integer | no | 0 |  |
| `start_date` | timestamptz | no |  |  |
| `end_date` | timestamptz | no |  |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_by` | bigint | sí |  | FK → `users.id` |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Claves foráneas:** `created_by` → `users.id`

**Índices:**
- `public.promotions USING btree (is_active)`
- `public.promotions USING btree (start_date, end_date)`
- `public.promotions USING btree (priority)`

#### `promotion_conditions` — 0 filas

Condiciones de una promoción.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('promotion_conditions_id_seq'::regclass) | Identificador único (PK) |
| `promotion_id` | bigint | no |  | FK → `promotions.id` |
| `condition_type` | USER-DEFINED | no |  |  |
| `operator` | USER-DEFINED | no |  |  |
| `value` | jsonb | no |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `promotion_id` → `promotions.id` (ON DELETE CASCADE)

**Índices:**
- `public.promotion_conditions USING btree (promotion_id)`

#### `promotion_products` — 0 filas

Productos alcanzados por una promoción.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `promotion_id` | bigint | no |  | FK → `promotions.id` |
| `product_variant_id` | bigint | no |  | FK → `product_variants.id` |
| `discount_value` | numeric(12,2) | no |  |  |
| `is_percentage` | boolean | no | true |  |
| `maximum_discount` | numeric(12,2) | sí |  |  |

**Claves foráneas:** `product_variant_id` → `product_variants.id` (ON DELETE CASCADE); `promotion_id` → `promotions.id` (ON DELETE CASCADE)

### Entrega / delivery

#### `delivery_drivers` — 7 filas

Repartidores.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('delivery_drivers_id_seq'::regclass) | Identificador único (PK) |
| `full_name` | varchar(100) | no |  | Nombre completo |
| `phone` | varchar(50) | no |  | Teléfono |
| `email` | text | sí |  | Correo |
| `vehicle_type` | varchar(50) | sí |  | Tipo de vehículo |
| `vehicle_plate` | varchar(20) | sí |  | Placa |
| `vehicle_brand` | varchar(100) | sí |  | Marca del vehículo |
| `vehicle_model` | varchar(100) | sí |  | Modelo |
| `vehicle_color` | varchar(50) | sí |  | Color |
| `is_available` | boolean | no | true | Disponible |
| `is_active` | boolean | no | true | Indica si está activo |
| `current_location` | text | sí |  | Última ubicación (PostGIS) |
| `last_location_at` | timestamptz | sí |  | Fecha de la última ubicación |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |
| `auth_user_id` | bigint | sí |  | Usuario de autenticación asociado |
| `push_token` | text | sí |  |  |
| `route_color` | varchar(9) | sí |  | Color de ruta en el mapa |
| `last_seen_at` | timestamptz | sí |  | Última conexión |
| `avatar_url` | text | sí |  | Avatar |
| `cargo_volume_cm3` | integer | sí |  | Volumen de carga en cm³ |

**Índices:**
- `public.delivery_drivers USING btree (is_active)`
- `public.delivery_drivers USING btree (is_available)`

#### `delivery_assignments` — 78 filas

Asignación de un pedido a un repartidor.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('delivery_assignments_id_seq'::regclass) | Identificador único (PK) |
| `shipment_id` | bigint | no |  | Envío |
| `driver_id` | bigint | no |  | Repartidor |
| `assigned_at` | timestamptz | no | now() | Fecha de asignación |
| `estimated_arrival` | timestamptz | sí |  | Llegada estimada |
| `picked_up_at` | timestamptz | sí |  | Fecha de recogida |
| `completed_at` | timestamptz | sí |  | Entrega completada |
| `cancelled_at` | timestamptz | sí |  | Cancelado |
| `cancel_reason` | text | sí |  | Motivo de cancelación |
| `status` | USER-DEFINED | no | 'ASSIGNED' | Estado de la asignación |
| `accepted_at` | timestamptz | sí |  | Aceptado |
| `ready_for_pickup_at` | timestamptz | sí |  | Listo para recogida |
| `in_delivery_at` | timestamptz | sí |  | En camino |
| `rejected_at` | timestamptz | sí |  | Rechazado |
| `failed_at` | timestamptz | sí |  | Fallido |
| `reject_reason` | text | sí |  | Motivo de rechazo |
| `delivery_note` | text | sí |  | Nota de entrega |

**Claves foráneas:** `driver_id` → `delivery_drivers.id` (ON DELETE RESTRICT); `shipment_id` → `shipments.id` (ON DELETE CASCADE)

**Índices:**
- `public.delivery_assignments USING btree (driver_id)`
- `UNIQUE public.delivery_assignments USING btree (shipment_id, driver_id)`
- `public.delivery_assignments USING btree (status)`
- `UNIQUE public.delivery_assignments USING btree (driver_id) WHERE (status = ANY (ARRAY['PICKED_UP'::delivery_assignment_status_enum, 'IN_DELIVERY'::delivery_assignment_status_enum]))`

#### `delivery_events` — 226 filas

Eventos del ciclo de entrega (recogido, en camino, entregado, etc.).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('delivery_events_id_seq'::regclass) | Identificador único (PK) |
| `assignment_id` | bigint | no |  | FK → `delivery_assignments.id` |
| `event_type` | USER-DEFINED | no |  |  |
| `location` | text | sí |  |  |
| `description` | text | sí |  | Descripción |
| `created_by` | bigint | sí |  | FK → `customers.id` |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `assignment_id` → `delivery_assignments.id` (ON DELETE CASCADE); `created_by` → `customers.id`

**Índices:**
- `public.delivery_events USING btree (assignment_id)`
- `public.delivery_events USING btree (created_at)`
- `public.delivery_events USING btree (event_type)`

#### `delivery_driver_locations` — 962 filas

Últimas posiciones GPS de repartidores.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('delivery_driver_locations_id_seq'::regclass) | Identificador único (PK) |
| `driver_id` | bigint | no |  | FK → `delivery_drivers.id` |
| `location` | text | no |  |  |
| `speed_kmh` | numeric(5,2) | sí |  |  |
| `heading_degrees` | integer | sí |  |  |
| `recorded_at` | timestamptz | no | now() |  |

**Claves foráneas:** `driver_id` → `delivery_drivers.id` (ON DELETE CASCADE)

**Índices:**
- `public.delivery_driver_locations USING btree (location)`
- `public.delivery_driver_locations USING btree (driver_id)`
- `public.delivery_driver_locations USING btree (driver_id, recorded_at)`
- `public.delivery_driver_locations USING btree (recorded_at)`

#### `delivery_proof_media` — 0 filas

Evidencias de entrega (fotos, firmas).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('delivery_proof_media_id_seq'::regclass) | Identificador único (PK) |
| `assignment_id` | bigint | no |  | FK → `delivery_assignments.id` |
| `kind` | USER-DEFINED | no |  |  |
| `url` | text | no |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `assignment_id` → `delivery_assignments.id` (ON DELETE CASCADE)

**Índices:**
- `public.delivery_proof_media USING btree (assignment_id)`

#### `delivery_zones` — 0 filas

Zonas de cobertura de entrega.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('delivery_zones_id_seq'::regclass) | Identificador único (PK) |
| `branch_id` | bigint | no |  | FK → `branches.id` |
| `name` | varchar(100) | no |  | Nombre |
| `delivery_price` | numeric(12,2) | no | '0' |  |
| `display_order` | smallint | sí |  |  |
| `schedule` | jsonb | sí |  |  |
| `coverage_area` | text | no |  |  |
| `estimated_min_minutes` | smallint | no |  |  |
| `estimated_max_minutes` | smallint | no |  |  |
| `delivery_type` | varchar(30) | no | 'STANDARD' |  |
| `minimum_order` | numeric(12,2) | no | '0' |  |
| `estimated_time_minutes` | integer | no | 60 |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Claves foráneas:** `branch_id` → `branches.id` (ON DELETE RESTRICT)

**Índices:**
- `public.delivery_zones USING btree (coverage_area)`

#### `delivery_time_slots` — 0 filas

Franjas horarias de entrega.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('delivery_time_slots_id_seq'::regclass) | Identificador único (PK) |
| `branch_id` | bigint | no |  | FK → `branches.id` |
| `day_of_week` | integer | no |  |  |
| `start_time` | time without time zone | no |  |  |
| `end_time` | time without time zone | no |  |  |
| `max_orders` | integer | sí | 10 |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `branch_id` → `branches.id` (ON DELETE CASCADE)

**Índices:**
- `public.delivery_time_slots USING btree (branch_id)`

#### `driver_chat_messages` — 10 filas

Chat entre repartidor y operación/cliente.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('driver_chat_messages_id_seq'::regclass) | Identificador único (PK) |
| `driver_id` | bigint | no |  | FK → `delivery_drivers.id` |
| `sender_type` | USER-DEFINED | no |  |  |
| `sender_user_id` | bigint | sí |  | FK → `users.id` |
| `body` | text | no |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `read_at` | timestamptz | sí |  |  |

**Claves foráneas:** `driver_id` → `delivery_drivers.id` (ON DELETE CASCADE); `sender_user_id` → `users.id` (ON DELETE SET NULL)

**Índices:**
- `public.driver_chat_messages USING btree (driver_id, id)`
- `public.driver_chat_messages USING btree (driver_id) WHERE (read_at IS NULL)`

#### `order_chat_messages` — 0 filas

Chat asociado a un pedido.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('order_chat_messages_id_seq'::regclass) | Identificador único (PK) |
| `order_id` | bigint | no |  | FK → `orders.id` |
| `sender_type` | USER-DEFINED | no |  |  |
| `sender_user_id` | bigint | sí |  | FK → `users.id` |
| `sender_guest_session_id` | bigint | sí |  | FK → `guest_sessions.id` |
| `body` | text | no |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `read_at` | timestamptz | sí |  |  |

**Claves foráneas:** `order_id` → `orders.id` (ON DELETE CASCADE); `sender_guest_session_id` → `guest_sessions.id` (ON DELETE SET NULL); `sender_user_id` → `users.id` (ON DELETE SET NULL)

**Índices:**
- `public.order_chat_messages USING btree (order_id)`

### Picking y listas

#### `picker_chat_messages` — 4 filas

Chat con pickers (armado de pedidos).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('picker_chat_messages_id_seq'::regclass) | Identificador único (PK) |
| `picker_id` | bigint | no |  | FK → `users.id` |
| `sender_type` | USER-DEFINED | no |  |  |
| `sender_user_id` | bigint | sí |  | FK → `users.id` |
| `body` | text | no |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `read_at` | timestamptz | sí |  |  |

**Claves foráneas:** `picker_id` → `users.id` (ON DELETE CASCADE); `sender_user_id` → `users.id` (ON DELETE SET NULL)

**Índices:**
- `public.picker_chat_messages USING btree (picker_id, id)`
- `public.picker_chat_messages USING btree (picker_id) WHERE (read_at IS NULL)`

#### `shopping_lists` — 0 filas

Listas de compras del cliente.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('shopping_lists_id_seq'::regclass) | Identificador único (PK) |
| `customer_id` | bigint | no |  | FK → `customers.id` |
| `name` | varchar(255) | no |  | Nombre |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `customer_id` → `customers.id` (ON DELETE CASCADE)

**Índices:**
- `public.shopping_lists USING btree (customer_id)`

#### `shopping_list_items` — 0 filas

Ítems de una lista de compras.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('shopping_list_items_id_seq'::regclass) | Identificador único (PK) |
| `list_id` | bigint | no |  | FK → `shopping_lists.id` |
| `product_id` | bigint | no |  | FK → `products.id` |
| `quantity` | integer | no | 1 |  |
| `added_at` | timestamptz | no | now() |  |

**Claves foráneas:** `list_id` → `shopping_lists.id` (ON DELETE CASCADE); `product_id` → `products.id` (ON DELETE CASCADE)

**Índices:**
- `public.shopping_list_items USING btree (list_id)`

#### `favorites` — 0 filas

Productos favoritos del cliente.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `customer_id` | bigint | no |  | FK → `customers.id` |
| `product_id` | bigint | no |  | FK → `products.id` |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Claves foráneas:** `customer_id` → `customers.id` (ON DELETE CASCADE); `product_id` → `products.id` (ON DELETE CASCADE)

### Contenido / CMS

#### `banners` — 10 filas

Banners publicitarios (carruseles, home).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('banners_id_seq'::regclass) | Identificador único (PK) |
| `title` | varchar(100) | sí |  |  |
| `media_id` | bigint | no |  | FK → `media.id` |
| `link_url` | text | sí |  |  |
| `link_target` | varchar(20) | no | '_self' |  |
| `alt_text` | varchar(255) | sí |  |  |
| `description` | text | sí |  | Descripción |
| `subtitle` | text | sí |  |  |
| `cta_text` | varchar(100) | sí |  |  |
| `bg_color` | varchar(20) | sí |  |  |
| `accent_color` | varchar(20) | sí |  |  |
| `banner_type` | varchar(20) | no | 'promo' |  |
| `position` | integer | sí | 0 | Orden de presentación |
| `is_active` | boolean | no | true | Indica si está activo |
| `start_date` | timestamptz | sí |  |  |
| `end_date` | timestamptz | sí |  |  |
| `mobile_image_id` | bigint | sí |  | FK → `media.id` |
| `filter_id` | bigint | sí |  | FK → `saved_filters.id` |
| `clicks` | integer | no | 0 |  |
| `views` | integer | no | 0 |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `filter_id` → `saved_filters.id` (ON DELETE SET NULL); `media_id` → `media.id` (ON DELETE CASCADE); `mobile_image_id` → `media.id` (ON DELETE SET NULL)

**Índices:**
- `public.banners USING btree (is_active)`
- `public.banners USING btree (start_date, end_date)`
- `public.banners USING btree ("position")`
- `public.banners USING btree (banner_type)`

#### `pages` — 0 filas

Páginas de contenido estático.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('pages_id_seq'::regclass) | Identificador único (PK) |
| `meta_keywords` | text | sí |  |  |
| `published_at` | timestamptz | sí |  |  |
| `created_by` | bigint | sí |  | FK → `users.id` |
| `updated_by` | bigint | sí |  | FK → `users.id` |
| `title` | varchar(200) | no |  |  |
| `slug` | varchar(200) | no |  | Identificador legible para URL |
| `content` | text | sí |  |  |
| `meta_title` | varchar(200) | sí |  |  |
| `meta_description` | text | sí |  |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Claves foráneas:** `created_by` → `users.id`; `updated_by` → `users.id`

**Índices:**
- `public.pages USING btree (is_active)`
- `public.pages USING btree (slug)`
- `UNIQUE public.pages USING btree (slug)`

#### `menus` — 0 filas

Menús de navegación.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('menus_id_seq'::regclass) | Identificador único (PK) |
| `name` | varchar(100) | no |  | Nombre |
| `location` | USER-DEFINED | sí |  |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Índices:**
- `UNIQUE public.menus USING btree (location)`

#### `menu_items` — 0 filas

Ítems de menú (con jerarquía).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('menu_items_id_seq'::regclass) | Identificador único (PK) |
| `menu_id` | bigint | no |  | FK → `menus.id` |
| `parent_id` | bigint | sí |  | FK → `menu_items.id` |
| `title` | varchar(100) | no |  |  |
| `link_url` | text | no |  |  |
| `icon` | varchar(100) | sí |  |  |
| `css_class` | varchar(100) | sí |  |  |
| `page_id` | bigint | sí |  | FK → `pages.id` |
| `target` | varchar(20) | sí | '_self' |  |
| `position` | integer | sí | 0 | Orden de presentación |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `menu_id` → `menus.id` (ON DELETE CASCADE); `page_id` → `pages.id` (ON DELETE SET NULL); `parent_id` → `menu_items.id` (ON DELETE CASCADE)

**Índices:**
- `public.menu_items USING btree (menu_id)`
- `public.menu_items USING btree (parent_id)`
- `public.menu_items USING btree (menu_id, "position")`

#### `popups` — 1 filas

Popups promocionales del sitio.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('popups_id_seq'::regclass) | Identificador único (PK) |
| `title` | varchar(200) | no |  |  |
| `image_media_id` | bigint | no |  | FK a `media` |
| `position` | USER-DEFINED | no | 'header' | Orden de presentación |
| `filter_config` | jsonb | sí | '{}' |  |
| `duration_ms` | integer | no | 7000 |  |
| `delay_ms` | integer | no | 1500 |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `start_date` | timestamptz | sí |  |  |
| `end_date` | timestamptz | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |
| `max_height` | integer | sí |  |  |

**Claves foráneas:** `image_media_id` → `media.id` (ON DELETE CASCADE)

**Índices:**
- `public.popups USING btree (is_active)`
- `public.popups USING btree ("position")`

#### `store` — 1 filas

Datos de la tienda/tenant (información de la empresa).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('store_id_seq'::regclass) | Identificador único (PK) |
| `status` | varchar(20) | no | 'ACTIVE' | Estado del registro |
| `legal_name` | varchar(200) | no |  |  |
| `trade_name` | varchar(200) | no |  |  |
| `tax_id` | varchar(50) | no |  |  |
| `tax_regime` | varchar(50) | no |  |  |
| `business_name` | varchar(255) | no |  |  |
| `invoice_provider` | varchar(50) | no |  |  |
| `invoice_prefix` | varchar(10) | no |  |  |
| `supported_languages` | jsonb | sí |  |  |
| `supported_currencies` | jsonb | sí |  |  |
| `invoice_resolution` | varchar(50) | sí |  |  |
| `email` | varchar(255) | no |  | Correo electrónico |
| `phone` | varchar(50) | no |  | Teléfono |
| `primary_domain` | varchar(255) | no |  |  |
| `secondary_domains` | jsonb | sí |  |  |
| `address` | text | no |  |  |
| `logo_media_id` | bigint | sí |  | FK a `media` |
| `theme_config` | jsonb | sí | '{}' |  |
| `currency_code` | varchar(3) | no | 'COP' |  |
| `language` | varchar(10) | no | 'es' |  |
| `timezone` | varchar(50) | no | 'America/Bogota' |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `whatsapp` | varchar(50) | sí |  |  |

**Claves foráneas:** `logo_media_id` → `media.id` (ON DELETE SET NULL)

**Índices:**
- `UNIQUE public.store USING btree (tax_id)`

#### `media` — 15.705 filas

Medios (imágenes). Guarda `provider` (local/cloudinary), `path`/`url`; la URL original de Cloudinary queda en `metadata.cloudinary_url`.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('media_id_seq'::regclass) | Identificador único (PK) |
| `status` | USER-DEFINED | no | 'active' | Estado del medio |
| `media_type` | USER-DEFINED | no |  | Tipo (image/video…) |
| `uploaded_by` | bigint | sí |  | Usuario que subió el archivo |
| `provider` | varchar(50) | no | 'local' | Origen del archivo: `local` o `cloudinary` |
| `path` | text | no |  | Ruta pública (p. ej. `/static/...`) |
| `file_name` | varchar(255) | no |  | Nombre del archivo |
| `mime_type` | varchar(100) | no |  | Tipo MIME |
| `size_bytes` | bigint | no |  | Tamaño en bytes |
| `width` | integer | sí |  | Ancho en px |
| `height` | integer | sí |  | Alto en px |
| `checksum` | varchar(64) | no |  | Suma de verificación |
| `metadata` | jsonb | sí | '{}' | Datos adicionales en JSON |
| `alt_text` | varchar(255) | sí |  | Texto alternativo |
| `is_public` | boolean | no | true | Público |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `uploaded_by` → `users.id`

**Índices:**
- `public.media USING btree (media_type)`
- `public.media USING btree (mime_type)`
- `public.media USING btree (provider)`
- `public.media USING btree (status)`
- `public.media USING btree (uploaded_by)`
- `UNIQUE public.media USING btree (checksum)`

#### `featured_product_tabs` — 4 filas

Pestañas de productos destacados (Lo más vendido, Novedades, etc.).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('featured_product_tabs_id_seq'::regclass) | Identificador único (PK) |
| `name` | varchar(100) | no |  | Nombre |
| `slug` | varchar(50) | no |  | Identificador legible para URL |
| `position` | integer | no | 0 | Orden de presentación |
| `is_active` | boolean | no | true | Indica si está activo |
| `query_on_sale` | boolean | sí |  |  |
| `query_sort` | varchar(50) | sí |  |  |
| `is_default` | boolean | no | false |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Índices:**
- `UNIQUE public.featured_product_tabs USING btree (slug)`
- `public.featured_product_tabs USING btree ("position")`

#### `featured_product_assignments` — 96 filas

Productos asignados a una pestaña destacada.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('featured_product_assignments_id_seq'::regclass) | Identificador único (PK) |
| `tab_id` | bigint | no |  | FK → `featured_product_tabs.id` |
| `product_id` | bigint | no |  | FK → `products.id` |
| `position` | integer | no | 0 | Orden de presentación |
| `is_active` | boolean | no | true | Indica si está activo |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Claves foráneas:** `product_id` → `products.id` (ON DELETE CASCADE); `tab_id` → `featured_product_tabs.id` (ON DELETE CASCADE)

**Índices:**
- `UNIQUE public.featured_product_assignments USING btree (tab_id, product_id)`
- `public.featured_product_assignments USING btree (tab_id)`

### Marketing y notificaciones

#### `campaigns` — 10 filas

Campañas de marketing (campañas del CRM/notificaciones).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('campaigns_id_seq'::regclass) | Identificador único (PK) |
| `name` | varchar(200) | no |  | Nombre |
| `product_id` | bigint | sí |  |  |
| `prompt` | text | sí |  |  |
| `tone` | varchar(50) | sí |  |  |
| `channels` | jsonb | no | '[]' |  |
| `mode` | varchar(10) | no | 'multi' |  |
| `status` | USER-DEFINED | no | 'borrador' | Estado del registro |
| `audience_count` | integer | no | 0 |  |
| `scheduled_at` | timestamptz | sí |  |  |
| `sent_at` | timestamptz | sí |  |  |
| `sent_count` | integer | no | 0 |  |
| `opened_count` | integer | no | 0 |  |
| `converted_count` | integer | no | 0 |  |
| `created_by` | bigint | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |
| `audience_mode` | varchar(10) | no | 'auto' |  |
| `priority_channel` | USER-DEFINED | sí |  |  |

**Índices:**
- `public.campaigns USING btree (deleted_at)`
- `public.campaigns USING btree (status)`

#### `campaign_history` — 17 filas

Historial de cambios de una campaña.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('campaign_history_id_seq'::regclass) | Identificador único (PK) |
| `campaign_id` | bigint | no |  |  |
| `action` | varchar(30) | no |  |  |
| `status` | varchar(20) | sí |  | Estado del registro |
| `details` | jsonb | sí |  |  |
| `created_by` | bigint | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Índices:**
- `public.campaign_history USING btree (campaign_id)`

#### `campaign_messages` — 15 filas

Mensajes/plantillas de una campaña.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('campaign_messages_id_seq'::regclass) | Identificador único (PK) |
| `campaign_id` | bigint | no |  |  |
| `channel` | USER-DEFINED | no |  |  |
| `subject` | varchar(300) | sí |  |  |
| `content` | text | sí |  |  |
| `html` | text | sí |  |  |
| `email_blocks` | jsonb | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Índices:**
- `public.campaign_messages USING btree (campaign_id)`
- `UNIQUE public.campaign_messages USING btree (campaign_id, channel)`

#### `campaign_products` — 12 filas

Productos incluidos en una campaña.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('campaign_products_id_seq'::regclass) | Identificador único (PK) |
| `campaign_id` | bigint | no |  |  |
| `product_id` | bigint | no |  |  |
| `position` | integer | no | 0 | Orden de presentación |
| `created_at` | timestamptz | no | now() | Fecha de creación |

**Índices:**
- `public.campaign_products USING btree (campaign_id)`
- `UNIQUE public.campaign_products USING btree (campaign_id, product_id)`

#### `campaign_recipients` — 9.529 filas

Destinatarios de una campaña y su estado de envío.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('campaign_recipients_id_seq'::regclass) | Identificador único (PK) |
| `campaign_id` | bigint | no |  |  |
| `customer_id` | bigint | sí |  |  |
| `name` | varchar(200) | sí |  | Nombre |
| `email` | varchar(255) | sí |  | Correo electrónico |
| `phone` | varchar(50) | sí |  | Teléfono |
| `status` | USER-DEFINED | no | 'pendiente' | Estado del registro |
| `sent_at` | timestamptz | sí |  |  |
| `opened_at` | timestamptz | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `cedula` | varchar(50) | sí |  |  |
| `segmento` | integer | sí |  |  |
| `frecuencia` | double | sí |  |  |
| `monetario` | double | sí |  |  |
| `ticket_promedio` | double | sí |  |  |
| `categorias_distintas` | double | sí |  |  |
| `propensity` | double | sí |  |  |

**Índices:**
- `public.campaign_recipients USING btree (campaign_id)`
- `public.campaign_recipients USING btree (status)`

#### `newsletter_campaigns` — 0 filas

Envíos de newsletter.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('newsletter_campaigns_id_seq'::regclass) | Identificador único (PK) |
| `title` | varchar(200) | no |  |  |
| `subject` | varchar(200) | no |  |  |
| `content` | text | no |  |  |
| `imageUrl` | varchar(500) | sí |  |  |
| `status` | USER-DEFINED | no | 'borrador' | Estado del registro |
| `scheduled_at` | timestamptz | sí |  |  |
| `sent_at` | timestamptz | sí |  |  |
| `sent_count` | integer | sí | 0 |  |
| `failed_count` | integer | sí | 0 |  |
| `error_message` | text | sí |  |  |
| `created_by` | bigint | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Índices:**
- `public.newsletter_campaigns USING btree (status)`

#### `newsletter_subscribers` — 1 filas

Suscriptores de newsletter.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('newsletter_subscribers_id_seq'::regclass) | Identificador único (PK) |
| `email` | varchar(255) | no |  | Correo electrónico |
| `name` | varchar(120) | sí |  | Nombre |
| `accepted_terms` | boolean | no | false |  |
| `is_active` | boolean | no | true | Indica si está activo |
| `source` | varchar(50) | sí | 'landing' |  |
| `subscribed_at` | timestamptz | no | now() |  |
| `unsubscribed_at` | timestamptz | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |
| `deleted_at` | timestamptz | sí |  | Fecha de borrado lógico (soft delete) |

**Índices:**
- `public.newsletter_subscribers USING btree (is_active)`
- `UNIQUE public.newsletter_subscribers USING btree (email)`

#### `notifications` — 40 filas

Notificaciones del sistema/para usuarios.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('notifications_id_seq'::regclass) | Identificador único (PK) |
| `type` | USER-DEFINED | no |  |  |
| `channel` | USER-DEFINED | no | 'IN_APP' |  |
| `title` | varchar(255) | no |  |  |
| `message` | text | sí |  |  |
| `sent_at` | timestamptz | sí |  |  |
| `is_read` | boolean | no | false |  |
| `target_user_id` | bigint | sí |  |  |
| `target_customer_id` | bigint | sí |  | FK → `customers.id` |
| `link_url` | text | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `read_at` | timestamptz | sí |  |  |

**Claves foráneas:** `target_customer_id` → `customers.id` (ON DELETE CASCADE)

**Índices:**
- `public.notifications USING btree (created_at)`
- `public.notifications USING btree (target_customer_id)`
- `public.notifications USING btree (target_customer_id, is_read) WHERE (is_read = false)`
- `public.notifications USING btree (is_read)`
- `public.notifications USING btree (target_user_id)`

### Infraestructura

#### `background_jobs` — 0 filas

Cola de trabajos en segundo plano.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | bigint | no | nextval('background_jobs_id_seq'::regclass) | Identificador único (PK) |
| `job_name` | varchar(100) | no |  |  |
| `queue_name` | varchar(50) | no | 'default' |  |
| `correlation_id` | uuid | sí |  |  |
| `worker_name` | varchar(100) | sí |  |  |
| `last_error_at` | timestamptz | sí |  |  |
| `finished_at` | timestamptz | sí |  |  |
| `payload` | jsonb | no |  |  |
| `priority` | integer | sí | 5 |  |
| `attempts` | integer | sí | 0 |  |
| `max_attempts` | integer | sí | 3 |  |
| `status` | USER-DEFINED | no | 'PENDING' | Estado del registro |
| `locked_at` | timestamptz | sí |  |  |
| `scheduled_at` | timestamptz | sí | now() |  |
| `started_at` | timestamptz | sí |  |  |
| `result` | jsonb | sí |  |  |
| `retry_at` | timestamptz | sí |  |  |
| `error_message` | text | sí |  |  |
| `error_stack` | text | sí |  |  |
| `created_at` | timestamptz | no | now() | Fecha de creación |
| `updated_at` | timestamptz | no | now() | Fecha de última actualización |

**Índices:**
- `public.background_jobs USING btree (priority)`
- `public.background_jobs USING btree (queue_name)`
- `public.background_jobs USING btree (scheduled_at)`
- `public.background_jobs USING btree (status)`

### Sistema (PostGIS)

#### `spatial_ref_sys` — 8.500 filas

Tabla de sistema de PostGIS: catálogo de sistemas de referencia espacial (SRID). No es parte del dominio de negocio.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `srid` | integer | no |  | Parte de la PK |
| `auth_name` | varchar(256) | sí |  |  |
| `auth_srid` | integer | sí |  |  |
| `srtext` | varchar(2048) | sí |  |  |
| `proj4text` | varchar(2048) | sí |  |  |

### Otras tablas

#### `product_images` — 15.597 filas

Imágenes de un producto: enlaza `product_id` con `media`. `sort_order` define el orden y la portada.

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | bigint | no | nextval('product_images_id_seq'::regclass) |
| `product_id` | bigint | no |  |
| `media_id` | bigint | no |  |
| `is_cover` | boolean | no | false |
| `position` | integer | sí | 0 |
| `created_at` | timestamptz | no | now() |
| `updated_at` | timestamptz | no | now() |

---

_Nota: este documento se regenera con `node scripts-agent/gen-db-docs.mjs`. Las descripciones marcadas como “pendiente” pueden completarse en el diccionario del generador._
