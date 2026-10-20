#!/usr/bin/env node
/**
 * Genera la documentación del modelo de datos actual (Postgres `ecommerce`)
 * a partir del esquema real, no del archivo drizzle/schema.ts.
 *
 * Salidas (por defecto):
 *   docs/DATABASE.md          -> panorama + referencia completa por dominio
 *   docs/DATABASE-schema.json -> volcado estructurado (máquina)
 *
 * Uso: node scripts-agent/gen-db-docs.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

// `pg` vive en backend/node_modules (no hay node_modules en la raíz).
const require = createRequire(import.meta.url);
const { Client } = require(resolve('backend/node_modules/pg'));

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const OUT_MD = process.env.OUT_MD || 'docs/DATABASE.md';
const OUT_JSON = process.env.OUT_JSON || 'docs/DATABASE-schema.json';

/* ------------------------------------------------------------------ *
 * Agrupación por dominio (curado a mano según el modelo del proyecto)
 * ------------------------------------------------------------------ */
const DOMAINS = {
  'Núcleo de catálogo': [
    'products', 'product_variants', 'brands', 'categories', 'product_categories',
    'product_types', 'product_type_assignments', 'attributes', 'attribute_options',
    'variant_attributes', 'product_attributes',
  ],
  'Impuestos y proveedores': [
    'product_tax_classes', 'tax_rates', 'suppliers', 'supplier_products',
  ],
  'Sucursales, inventario y precios': [
    'branches', 'branch_products', 'inventory', 'inventory_movements',
    'inventory_reservations', 'prices', 'product_locations', 'shelves',
    'shelf_categories', 'user_branches',
  ],
  'Clientes (B2C)': [
    'customers', 'customer_addresses', 'customer_payment_methods',
    'customer_sessions', 'customer_refresh_tokens', 'customer_tokens',
    'guest_sessions',
  ],
  'Usuarios y seguridad (admin)': [
    'users', 'roles', 'permissions', 'role_permissions', 'user_roles',
    'user_sessions', 'user_refresh_tokens', 'audit_logs', 'saved_filters', 'settings',
  ],
  'Carrito y pedidos': [
    'carts', 'cart_items', 'orders', 'order_items', 'order_status_history',
    'invoices', 'payments', 'payment_intents', 'refunds', 'shipments',
  ],
  'Promociones y cupones': [
    'coupons', 'coupon_redemptions', 'promotions', 'promotion_conditions',
    'promotion_products',
  ],
  'Entrega / delivery': [
    'delivery_drivers', 'delivery_assignments', 'delivery_events',
    'delivery_driver_locations', 'delivery_proof_media', 'delivery_zones',
    'delivery_time_slots', 'driver_chat_messages', 'order_chat_messages',
  ],
  'Picking y listas': [
    'picker_chat_messages', 'shopping_lists', 'shopping_list_items', 'favorites',
  ],
  'Contenido / CMS': [
    'banners', 'pages', 'menus', 'menu_items', 'popups', 'store', 'media',
    'featured_product_tabs', 'featured_product_assignments',
  ],
  'Marketing y notificaciones': [
    'campaigns', 'campaign_history', 'campaign_messages', 'campaign_products',
    'campaign_recipients', 'newsletter_campaigns', 'newsletter_subscribers',
    'notifications',
  ],
  'Infraestructura': ['background_jobs'],
  'Sistema (PostGIS)': ['spatial_ref_sys'],
};

/* Descripción por tabla (curada). Si falta, se marca como pendiente. */
const TABLE_DESC = {
  products: 'Producto padre (cabecera comercial). Agrupa variantes, categorías, tipos, atributos y medios. `external_id` guarda el código TID largo (15 díg.), `plu` el código corto.',
  product_variants: 'Variante vendible de un producto (SKU). Aquí viven `sku` (código TID largo) y `barcode` (EAN). Es lo que referencian precios, inventario y líneas de pedido.',
  brands: 'Marcas. En el catálogo TID la marca real proviene de `INMARCAP`.',
  categories: 'Categorías de catálogo (árbol con `parent_id`).',
  product_categories: 'Relación N:M producto → categoría.',
  product_types: 'Tipos de producto (clasificación comercial/operativa).',
  product_type_assignments: 'Relación N:M producto → tipo de producto.',
  attributes: 'Definición de atributos (color, talla, etc.).',
  attribute_options: 'Valores posibles de un atributo.',
  variant_attributes: 'Valores de atributo asignados a una variante.',
  product_attributes: 'Atributos a nivel de producto (p. ej. ficha técnica, dimensiones migradas del TID).',
  product_images: 'Imágenes de un producto: enlaza `product_id` con `media`. `sort_order` define el orden y la portada.',
  product_tax_classes: 'Clase de impuesto por producto.',
  tax_rates: 'Tarifas de impuesto (IVA, etc.).',
  suppliers: 'Proveedores del catálogo TID (`INPROVEE`).',
  supplier_products: 'Relación N:M proveedor → producto.',
  branches: 'Sucursales / bodegas (empresa-tienda). Cada producto y precio puede variar por sucursal.',
  branch_products: 'Disponibilidad de un producto en una sucursal (habilitado, destacado, etc.).',
  inventory: 'Existencia (stock) por variante y sucursal.',
  inventory_movements: 'Movimientos/kardex de inventario (entradas, salidas, ajustes).',
  inventory_reservations: 'Reservas de inventario mientras un pedido está en curso.',
  prices: 'Precios por variante, sucursal y lista de precio.',
  product_locations: 'Ubicación física del producto dentro de una bodega.',
  shelves: 'Estantes / góndolas de una bodega.',
  shelf_categories: 'Relación estante → categoría.',
  user_branches: 'Sucursales asignadas a un usuario.',
  customers: 'Clientes B2C (compradores).',
  customer_addresses: 'Direcciones de los clientes.',
  customer_payment_methods: 'Métodos de pago guardados por el cliente.',
  customer_sessions: 'Sesiones activas de clientes.',
  customer_refresh_tokens: 'Tokens de refresco de autenticación de clientes.',
  customer_tokens: 'Tokens de un solo uso (verificación de correo, recuperación, etc.).',
  guest_sessions: 'Sesiones de invitados (carrito sin registro).',
  users: 'Usuarios administrativos/operativos (admin, picker, delivery).',
  roles: 'Roles del sistema.',
  permissions: 'Permisos atómicos del sistema.',
  role_permissions: 'Permisos asignados a un rol.',
  user_roles: 'Roles asignados a un usuario.',
  user_sessions: 'Sesiones activas de usuarios administrativos.',
  user_refresh_tokens: 'Tokens de refresco de usuarios administrativos.',
  audit_logs: 'Registro de auditoría de acciones.',
  saved_filters: 'Filtros guardados por usuario en el panel.',
  settings: 'Configuración clave/valor del sistema.',
  carts: 'Carrito de compras (de cliente o invitado).',
  cart_items: 'Líneas del carrito.',
  orders: 'Pedidos. Núcleo transaccional; referencia cliente, sucursal, entrega y estado.',
  order_items: 'Líneas del pedido (variante, cantidad, precio, impuestos).',
  order_status_history: 'Historial de cambios de estado de un pedido.',
  invoices: 'Facturas generadas para pedidos.',
  payments: 'Pagos realizados sobre un pedido.',
  payment_intents: 'Intenciones de pago (pasarela).',
  refunds: 'Reembolsos/devoluciones.',
  shipments: 'Envíos asociados a pedidos.',
  coupons: 'Cupones de descuento.',
  coupon_redemptions: 'Uso/redención de cupones.',
  promotions: 'Promociones comerciales.',
  promotion_conditions: 'Condiciones de una promoción.',
  promotion_products: 'Productos alcanzados por una promoción.',
  delivery_drivers: 'Repartidores.',
  delivery_assignments: 'Asignación de un pedido a un repartidor.',
  delivery_events: 'Eventos del ciclo de entrega (recogido, en camino, entregado, etc.).',
  delivery_driver_locations: 'Últimas posiciones GPS de repartidores.',
  delivery_proof_media: 'Evidencias de entrega (fotos, firmas).',
  delivery_zones: 'Zonas de cobertura de entrega.',
  delivery_time_slots: 'Franjas horarias de entrega.',
  driver_chat_messages: 'Chat entre repartidor y operación/cliente.',
  order_chat_messages: 'Chat asociado a un pedido.',
  picker_chat_messages: 'Chat con pickers (armado de pedidos).',
  shopping_lists: 'Listas de compras del cliente.',
  shopping_list_items: 'Ítems de una lista de compras.',
  favorites: 'Productos favoritos del cliente.',
  banners: 'Banners publicitarios (carruseles, home).',
  pages: 'Páginas de contenido estático.',
  menus: 'Menús de navegación.',
  menu_items: 'Ítems de menú (con jerarquía).',
  popups: 'Popups promocionales del sitio.',
  store: 'Datos de la tienda/tenant (información de la empresa).',
  media: 'Medios (imágenes). Guarda `provider` (local/cloudinary), `path`/`url`; la URL original de Cloudinary queda en `metadata.cloudinary_url`.',
  featured_product_tabs: 'Pestañas de productos destacados (Lo más vendido, Novedades, etc.).',
  featured_product_assignments: 'Productos asignados a una pestaña destacada.',
  campaigns: 'Campañas de marketing (campañas del CRM/notificaciones).',
  campaign_history: 'Historial de cambios de una campaña.',
  campaign_messages: 'Mensajes/plantillas de una campaña.',
  campaign_products: 'Productos incluidos en una campaña.',
  campaign_recipients: 'Destinatarios de una campaña y su estado de envío.',
  newsletter_campaigns: 'Envíos de newsletter.',
  newsletter_subscribers: 'Suscriptores de newsletter.',
  notifications: 'Notificaciones del sistema/para usuarios.',
  background_jobs: 'Cola de trabajos en segundo plano.',
  spatial_ref_sys: 'Tabla de sistema de PostGIS: catálogo de sistemas de referencia espacial (SRID). No es parte del dominio de negocio.',
};

/* ------------------------------------------------------------------ */
const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

// Columnas
const columns = await q(`
  SELECT c.table_name, c.ordinal_position, c.column_name, c.data_type,
         c.udt_name, c.is_nullable, c.column_default,
         c.character_maximum_length, c.numeric_precision, c.numeric_scale,
         col_description(format('%I.%I', c.table_schema, c.table_name)::regclass::oid,
                         c.ordinal_position) AS comment
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
  ORDER BY c.table_name, c.ordinal_position;
`);

// Primary keys: columna -> posición
const pks = await q(`
  SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY'
  ORDER BY tc.table_name, kcu.ordinal_position;
`);

// Foreign keys
const fks = await q(`
  SELECT tc.table_name, kcu.column_name,
         ccu.table_name AS ref_table, ccu.column_name AS ref_column,
         rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
  WHERE tc.table_schema='public' AND tc.constraint_type='FOREIGN KEY'
  ORDER BY tc.table_name, kcu.column_name;
`);

// Índices (no primarios)
const indexes = await q(`
  SELECT tablename, indexname, indexdef
  FROM pg_indexes
  WHERE schemaname='public' AND indexname NOT LIKE '%_pkey'
  ORDER BY tablename, indexname;
`);

// Columnas con restricción/índice único (para cardinalidad 1:1 en el ER)
const uniques = await q(`
  SELECT t.relname AS table_name, a.attname AS column_name
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
  WHERE i.indisunique AND NOT i.indisprimary AND n.nspname='public'
    AND i.indnkeyatts = 1 AND i.indpred IS NULL
`);

// Conteo de filas (exacto)
const tableList = [...new Set(columns.map((c) => c.table_name))];
const counts = {};
for (const t of tableList) {
  try {
    const r = await q(`SELECT count(*)::bigint AS n FROM "${t}"`);
    counts[t] = Number(r[0].n);
  } catch {
    counts[t] = null;
  }
}

// Extensiones
const extensions = await q(`SELECT extname FROM pg_extension ORDER BY extname;`);

/* ---------------------------- helpers ---------------------------- */
const pkMap = {};
for (const r of pks) {
  (pkMap[r.table_name] ||= []).push(r.column_name);
}
const fkMap = {};
for (const r of fks) {
  (fkMap[r.table_name] ||= []).push(r);
}
const idxMap = {};
for (const r of indexes) {
  (idxMap[r.tablename] ||= []).push(r);
}
const byTable = {};
for (const c of columns) (byTable[c.table_name] ||= []).push(c);

const uniqueCols = new Set(uniques.map((u) => `${u.table_name}.${u.column_name}`));
const domainOf = {};
for (const d of Object.keys(DOMAINS)) for (const t of DOMAINS[d]) domainOf[t] = d;

const typeOf = (c) => {
  if (c.udt_name === 'varchar' || c.udt_name === 'bpchar')
    return `varchar(${c.character_maximum_length ?? 'n'})`;
  if (c.udt_name === 'numeric')
    return `numeric(${c.numeric_precision ?? '?'},${c.numeric_scale ?? '?'})`;
  if (c.udt_name === 'int8') return 'bigint';
  if (c.udt_name === 'int4') return 'integer';
  if (c.udt_name === 'int2') return 'smallint';
  if (c.udt_name === 'bool') return 'boolean';
  if (c.udt_name === 'timestamptz') return 'timestamptz';
  if (c.udt_name === 'timestamp') return 'timestamp';
  if (c.udt_name === 'float8') return 'double';
  if (c.udt_name === 'float4') return 'real';
  return c.data_type;
};

const COLUMN_DESC = {
  // products
  'products.id': 'PK', 'products.brand_id': 'FK a la marca',
  'products.external_id': 'Código externo/ERP. En TID es el código largo de 15 dígitos (`INARTIC`).',
  'products.name': 'Nombre del producto', 'products.slug': 'Slug único para URL',
  'products.description': 'Descripción del producto (visible al cliente)',
  'products.product_type': 'Estructura del producto: SIMPLE o con VARIANTES (no confundir con la tabla `product_types`)',
  'products.sku_prefix': 'Prefijo para generar SKUs', 'products.plu': 'PLU: código corto de caja/balanza (TID)',
  'products.featured': 'Producto destacado', 'products.manufacturer': 'Fabricante',
  'products.visibility': 'Visibilidad (PUBLIC/PRIVATE…)', 'products.is_public': 'Visible públicamente',
  'products.published_at': 'Fecha de publicación',
  // product_variants
  'product_variants.product_id': 'Producto padre',
  'product_variants.sku': 'SKU único de la variante (código TID largo)',
  'product_variants.barcode': 'Código de barras EAN (`INEAN`)',
  'product_variants.current_price': 'Precio de venta vigente (desnormalizado, referencia rápida)',
  'product_variants.current_compare_price': 'Precio “antes”/tachado para mostrar descuento',
  'product_variants.length_mm': 'Largo en mm (para volumen/rutas)',
  'product_variants.width_mm': 'Ancho en mm (para volumen/rutas)',
  'product_variants.height_mm': 'Alto en mm (para volumen/rutas)',
  'product_variants.cost_price': 'Costo unitario',
  // brands
  'brands.name': 'Nombre de la marca', 'brands.slug': 'Slug único',
  'brands.code': 'Código de marca', 'brands.website': 'Sitio web', 'brands.country': 'País de origen',
  'brands.logo_media_id': 'FK a `media` con el logo',
  'brands.is_public': 'Visible en el catálogo', 'brands.is_featured': 'Marca destacada',
  // categories
  'categories.parent_id': 'Categoría padre (auto-relación, árbol)',
  'categories.name': 'Nombre de la categoría', 'categories.slug': 'Slug único', 'categories.code': 'Código de categoría',
  'categories.display_order': 'Orden de visualización',
  'categories.image_media_id': 'FK a `media` con la imagen', 'categories.level': 'Nivel en el árbol',
  'categories.meta_title': 'Título SEO', 'categories.meta_description': 'Descripción SEO',
  // product_types
  'product_types.code': 'Código del tipo', 'product_types.name': 'Nombre del tipo',
  'product_types.image_media_id': 'FK a `media` con el ícono/imagen',
  // branches
  'branches.code': 'Código de sucursal', 'branches.name': 'Nombre de la sucursal',
  'branches.address': 'Dirección', 'branches.city': 'Ciudad', 'branches.phone': 'Teléfono',
  'branches.store_id': 'FK a `store` (empresa/tenant)', 'branches.email': 'Correo',
  'branches.priority': 'Prioridad (desempate entre sucursales)',
  'branches.manager_name': 'Nombre del encargado', 'branches.manager_phone': 'Teléfono del encargado',
  'branches.max_daily_orders': 'Máximo de pedidos diarios',
  'branches.branch_type': 'Tipo de sucursal (tienda, bodega, etc.)',
  'branches.location': 'Ubicación geográfica (PostGIS geography/point)',
  'branches.delivery_radius_km': 'Radio de entrega en km', 'branches.schedule': 'Horario (JSON)',
  'branches.image_media_id': 'FK a `media` con la imagen', 'branches.is_visible': 'Visible en la app/tienda',
  // branch_products
  'branch_products.branch_id': 'Sucursal', 'branch_products.product_id': 'Producto',
  'branch_products.is_available': 'Disponible en la sucursal', 'branch_products.is_public': 'Visible en la sucursal',
  'branch_products.position': 'Orden dentro de la sucursal',
  // inventory
  'inventory.product_variant_id': 'Variante', 'inventory.branch_id': 'Sucursal',
  'inventory.stock': 'Existencia actual', 'inventory.reserved_stock': 'Existencia reservada (pedidos en curso)',
  'inventory.reorder_point': 'Punto de reorden', 'inventory.target_stock': 'Stock objetivo',
  'inventory.last_movement_at': 'Fecha del último movimiento', 'inventory.last_counted_at': 'Fecha del último conteo físico',
  'inventory.minimum_stock': 'Stock mínimo', 'inventory.maximum_stock': 'Stock máximo',
  // prices
  'prices.product_variant_id': 'Variante', 'prices.branch_id': 'Sucursal (el precio varía por sucursal)',
  'prices.start_date': 'Inicio de vigencia', 'prices.end_date': 'Fin de vigencia',
  'prices.changed_by': 'Usuario que cambió el precio', 'prices.change_reason': 'Motivo del cambio',
  'prices.cost': 'Costo de referencia', 'prices.price': 'Precio de venta',
  'prices.compare_price': 'Precio “antes”/tachado', 'prices.version': 'Versión/lista de precio',
  // orders
  'orders.reference_code': 'Código de pedido mostrado al cliente',
  'orders.customer_id': 'Cliente que compra', 'orders.guest_session_id': 'Sesión de invitado (si no hay registro)',
  'orders.branch_id': 'Sucursal que despacha', 'orders.delivery_zone_id': 'Zona de entrega',
  'orders.customer_address_id': 'Dirección de entrega', 'orders.status': 'Estado del pedido',
  'orders.currency_code': 'Moneda', 'orders.exchange_rate': 'Tasa de cambio',
  'orders.subtotal': 'Subtotal', 'orders.discount_total': 'Total descuentos', 'orders.tax_total': 'Total impuestos',
  'orders.shipping_cost': 'Costo de envío', 'orders.shipping_tax': 'Impuesto del envío',
  'orders.grand_total': 'Total a pagar', 'orders.customer_ip': 'IP del cliente',
  'orders.coupon_id': 'Cupón aplicado', 'orders.user_agent': 'User-Agent del navegador',
  'orders.notes': 'Notas del cliente', 'orders.internal_notes': 'Notas internas',
  'orders.reviewed_at': 'Fecha de revisión',
  'orders.customer_name': 'Nombre del cliente (snapshot)', 'orders.customer_phone': 'Teléfono (snapshot)',
  'orders.customer_email': 'Correo (snapshot)', 'orders.picker_id': 'Picker que armó el pedido',
  'orders.picked_at': 'Fecha de armado', 'orders.completed_at': 'Fecha de finalización',
  // order_items
  'order_items.order_id': 'Pedido', 'order_items.product_variant_id': 'Variante',
  'order_items.product_name': 'Nombre del producto (snapshot)', 'order_items.variant_sku': 'SKU (snapshot)',
  'order_items.quantity': 'Cantidad', 'order_items.unit_price_net': 'Precio unitario sin impuesto',
  'order_items.unit_price_gross': 'Precio unitario con impuesto', 'order_items.discount_amount': 'Descuento',
  'order_items.tax_amount': 'Impuesto', 'order_items.subtotal': 'Subtotal de la línea',
  'order_items.tax_rate': 'Tarifa de impuesto', 'order_items.total': 'Total de la línea',
  'order_items.tax_name': 'Nombre del impuesto', 'order_items.picked_qty': 'Cantidad realmente alistada',
  // customers
  'customers.email': 'Correo (login)', 'customers.password_hash': 'Hash de contraseña',
  'customers.document_number': 'Número de documento', 'customers.document_type': 'Tipo de documento',
  'customers.first_name': 'Nombres', 'customers.last_name': 'Apellidos', 'customers.phone': 'Teléfono',
  'customers.birth_date': 'Fecha de nacimiento', 'customers.gender': 'Género',
  'customers.customer_type': 'Tipo de cliente', 'customers.preferred_language': 'Idioma preferido',
  'customers.accepts_marketing': 'Acepta marketing', 'customers.accepts_terms_at': 'Fecha de aceptación de términos',
  'customers.is_verified': 'Verificado', 'customers.last_activity_at': 'Última actividad',
  'customers.last_login_at': 'Último inicio de sesión', 'customers.provider': 'Proveedor de identidad',
  'customers.provider_id': 'ID en el proveedor de identidad', 'customers.avatar_url': 'URL del avatar',
  'customers.email_verified': 'Correo verificado', 'customers.push_token': 'Token de notificaciones push',
  // media
  'media.status': 'Estado del medio', 'media.media_type': 'Tipo (image/video…)',
  'media.uploaded_by': 'Usuario que subió el archivo',
  'media.provider': 'Origen del archivo: `local` o `cloudinary`',
  'media.path': 'Ruta pública (p. ej. `/static/...`)', 'media.file_name': 'Nombre del archivo',
  'media.mime_type': 'Tipo MIME', 'media.size_bytes': 'Tamaño en bytes',
  'media.width': 'Ancho en px', 'media.height': 'Alto en px', 'media.checksum': 'Suma de verificación',
  'media.alt_text': 'Texto alternativo', 'media.is_public': 'Público',
  // product_images
  'product_images.product_id': 'Producto', 'product_images.media_id': 'Medio (imagen)',
  'product_images.is_cover': 'Es la portada', 'product_images.position': 'Orden',
  // product_attributes
  'product_attributes.product_id': 'Producto', 'product_attributes.attribute_id': 'Atributo',
  'product_attributes.attribute_option_id': 'Opción del atributo',
  'product_attributes.custom_value': 'Valor libre (si no es una opción predefinida)',
  // delivery_drivers
  'delivery_drivers.full_name': 'Nombre completo', 'delivery_drivers.phone': 'Teléfono',
  'delivery_drivers.email': 'Correo', 'delivery_drivers.vehicle_type': 'Tipo de vehículo',
  'delivery_drivers.vehicle_plate': 'Placa', 'delivery_drivers.vehicle_brand': 'Marca del vehículo',
  'delivery_drivers.vehicle_model': 'Modelo', 'delivery_drivers.vehicle_color': 'Color',
  'delivery_drivers.is_available': 'Disponible', 'delivery_drivers.current_location': 'Última ubicación (PostGIS)',
  'delivery_drivers.last_location_at': 'Fecha de la última ubicación',
  'delivery_drivers.auth_user_id': 'Usuario de autenticación asociado',
  'delivery_drivers.route_color': 'Color de ruta en el mapa', 'delivery_drivers.last_seen_at': 'Última conexión',
  'delivery_drivers.avatar_url': 'Avatar', 'delivery_drivers.cargo_volume_cm3': 'Volumen de carga en cm³',
  // delivery_assignments
  'delivery_assignments.shipment_id': 'Envío', 'delivery_assignments.driver_id': 'Repartidor',
  'delivery_assignments.assigned_at': 'Fecha de asignación', 'delivery_assignments.estimated_arrival': 'Llegada estimada',
  'delivery_assignments.picked_up_at': 'Fecha de recogida', 'delivery_assignments.completed_at': 'Entrega completada',
  'delivery_assignments.cancelled_at': 'Cancelado', 'delivery_assignments.cancel_reason': 'Motivo de cancelación',
  'delivery_assignments.status': 'Estado de la asignación', 'delivery_assignments.accepted_at': 'Aceptado',
  'delivery_assignments.ready_for_pickup_at': 'Listo para recogida', 'delivery_assignments.in_delivery_at': 'En camino',
  'delivery_assignments.rejected_at': 'Rechazado', 'delivery_assignments.failed_at': 'Fallido',
  'delivery_assignments.reject_reason': 'Motivo de rechazo', 'delivery_assignments.delivery_note': 'Nota de entrega',
};

const HEUR = [
  [/^id$/, 'Identificador único (PK)'],
  [/^created_at$/, 'Fecha de creación'],
  [/^updated_at$/, 'Fecha de última actualización'],
  [/^deleted_at$/, 'Fecha de borrado lógico (soft delete)'],
  [/^is_active$/, 'Indica si está activo'],
  [/^active$/, 'Indica si está activo'],
  [/^status$/, 'Estado del registro'],
  [/^slug$/, 'Identificador legible para URL'],
  [/^name$/, 'Nombre'],
  [/^description$/, 'Descripción'],
  [/^sort_order|^position$/, 'Orden de presentación'],
  [/^image(_url)?$/, 'Imagen (URL)'],
  [/^metadata$/, 'Datos adicionales en JSON'],
  [/^email$/, 'Correo electrónico'],
  [/^phone$/, 'Teléfono'],
  [/^password_hash$/, 'Hash de contraseña'],
  [/^expires_at$/, 'Fecha de expiración'],
  [/^(lat|latitude)$/, 'Latitud'],
  [/^(lng|lon|longitude)$/, 'Longitud'],
];

const colDesc = (c) => {
  if (c.comment) return c.comment;
  const cur = COLUMN_DESC[`${c.table_name}.${c.column_name}`];
  if (cur) return cur;
  if (/_(media_id)$/.test(c.column_name)) return 'FK a `media`';
  const fk = (fkMap[c.table_name] || []).find((f) => f.column_name === c.column_name);
  if (fk) return `FK → \`${fk.ref_table}.${fk.ref_column}\``;
  if ((pkMap[c.table_name] || []).includes(c.column_name) && !/^id$/.test(c.column_name))
    return 'Parte de la PK';
  for (const [re, txt] of HEUR) if (re.test(c.column_name)) return txt;
  return '';
};

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const fmtDef = (d) => {
  if (d == null) return '';
  return esc(String(d).replace(/::[a-z_ ]+$/i, '').slice(0, 60));
};

/* --------------------------- markdown --------------------------- */
const lines = [];
const P = (s = '') => lines.push(s);

const snapshotDate = new Date().toISOString().slice(0, 10);
const totalCols = columns.length;

P('# Modelo de datos — Ecommerce (Postgres)');
P();
P(`> Documento **generado** desde el esquema real de la base de datos \`ecommerce\`.`);
P(`> Fuente de verdad: \`backend/drizzle/schema.ts\`. Generador: \`scripts-agent/gen-db-docs.mjs\`.`);
P(`> Última generación: ${snapshotDate}.`);
P();
P('## Resumen');
P();
P(`- Tablas base: **${tableList.length}**`);
P(`- Columnas totales: **${totalCols}**`);
P(`- Extensiones: ${extensions.map((e) => `\`${e.extname}\``).join(', ')}`);
P(`- BD local: \`postgresql://postgres:postgres@localhost:5432/ecommerce\``);
P();
P('Filas por tabla (conteo exacto al momento de generar):');
P();
P('| Tabla | Filas | Dominio |');
P('|---|---:|---|');
for (const d of Object.keys(DOMAINS)) {
  for (const t of DOMAINS[d]) {
    if (!byTable[t]) continue;
    P(`| \`${t}\` | ${counts[t]?.toLocaleString('es-CO') ?? '—'} | ${d} |`);
  }
}
// Tablas no clasificadas
const classified = new Set(Object.values(DOMAINS).flat());
const others = tableList.filter((t) => !classified.has(t) && t !== 'spatial_ref_sys');
for (const t of others) P(`| \`${t}\` | ${counts[t]?.toLocaleString('es-CO') ?? '—'} | (sin clasificar) |`);
P();
P('## Convenciones del modelo');
P();
P('- **Claves primarias**: normalmente `id` (\`serial\`/\`uuid\`); en tablas puente la PK es compuesta.');
P('- **Borrado lógico**: columnas `deleted_at` / `is_active` en varias entidades.');
P('- **Multi-sucursal**: el catálogo se distribuye por sucursal mediante `branches`, `branch_products`, `inventory` y `prices`.');
P('- **Medios**: todo apunta a \`media\`; `provider` indica origen (`local`/`cloudinary`).');
P('- **Tipos**: los tipos mostrados usan `varchar(n)` con `n` real; `numeric(p,s)` indica precisión/escala.');
P();

// Diagrama ER del núcleo
P('## Diagrama entidad-relación (núcleo)');
P();
P('```mermaid');
P('erDiagram');
P('  BRANCHES ||--o{ BRANCH_PRODUCTS : contiene');
P('  BRANCHES ||--o{ INVENTORY : almacena');
P('  BRANCHES ||--o{ PRICES : precio_sucursal');
P('  PRODUCTS ||--o{ PRODUCT_VARIANTS : tiene');
P('  PRODUCTS ||--o{ PRODUCT_CATEGORIES : clasifica');
P('  CATEGORIES ||--o{ PRODUCT_CATEGORIES : agrupa');
P('  PRODUCTS ||--o{ PRODUCT_TYPE_ASSIGNMENTS : tipifica');
P('  PRODUCT_TYPES ||--o{ PRODUCT_TYPE_ASSIGNMENTS : agrupa');
P('  PRODUCTS ||--o{ PRODUCT_IMAGES : muestra');
P('  MEDIA ||--o{ PRODUCT_IMAGES : archivo');
P('  PRODUCT_VARIANTS ||--o{ INVENTORY : stock');
P('  PRODUCT_VARIANTS ||--o{ PRICES : precio');
P('  CUSTOMERS ||--o{ ORDERS : compra');
P('  ORDERS ||--o{ ORDER_ITEMS : detalle');
P('  PRODUCT_VARIANTS ||--o{ ORDER_ITEMS : referencia');
P('  ORDERS ||--o{ DELIVERY_ASSIGNMENTS : entrega');
P('  DELIVERY_DRIVERS ||--o{ DELIVERY_ASSIGNMENTS : reparte');
P('  BRANCHES ||--o{ ORDERS : despacha');
P('```');
P();

// ------------------ Diagramas de relaciones (auto) ------------------
const erId = (t) => t.toUpperCase();

// Agregación de FKs que cruzan dominios
const crossEdges = {};
for (const t of tableList) {
  const dom = domainOf[t];
  if (!dom) continue;
  for (const f of fkMap[t] || []) {
    const domB = domainOf[f.ref_table];
    if (!domB || domB === dom) continue;
    const k = `${dom}\u0000${domB}`;
    crossEdges[k] = (crossEdges[k] || 0) + 1;
  }
}

const domainOrder = Object.keys(DOMAINS).filter((d) => DOMAINS[d].some((t) => byTable[t]));
const did = {};
domainOrder.forEach((d, i) => (did[d] = `D${i}`));

P('## Diagramas de relaciones');
P();
P('Generados automáticamente desde las claves foráneas reales del esquema.');
P('Cardinalidad: `||--o{` = uno-a-muchos, `||--||` = uno-a-uno. La etiqueta es la columna FK.');
P();
P('### Visión general por dominios');
P();
P('```mermaid');
P('flowchart LR');
for (const d of domainOrder) P(`  ${did[d]}["${d}"]`);
for (const k of Object.keys(crossEdges)) {
  const [a, b] = k.split('\u0000');
  P(`  ${did[a]} -->|${crossEdges[k]}| ${did[b]}`);
}
P('```');
P();
P('Cada flecha indica cuántas claves foráneas cruzan de un dominio a otro.');
P();

// Un diagrama ER por dominio
for (const d of domainOrder) {
  const tables = DOMAINS[d].filter((t) => byTable[t]);
  const seen = new Set();
  const edges = [];
  for (const t of tables) {
    for (const f of fkMap[t] || []) {
      const childSide = uniqueCols.has(`${t}.${f.column_name}`) ? '||' : 'o{';
      const key = `${f.ref_table}|${t}|${childSide}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([f.ref_table, t, f.column_name, childSide]);
    }
  }
  if (!edges.length) continue;
  P(`### ${d}`);
  P();
  P('```mermaid');
  P('erDiagram');
  for (const [parent, child, col, childSide] of edges) {
    P(`  ${erId(parent)} ||--${childSide} ${erId(child)} : ${col}`);
  }
  P('```');
  P();
}

// Referencia completa
P('## Referencia de tablas');
P();
for (const d of Object.keys(DOMAINS)) {
  const tables = DOMAINS[d].filter((t) => byTable[t]);
  if (!tables.length) continue;
  P(`### ${d}`);
  P();
  for (const t of tables) {
    const cols = byTable[t];
    P(`#### \`${t}\` — ${counts[t]?.toLocaleString('es-CO') ?? '?'} filas`);
    P();
    if (TABLE_DESC[t]) P(esc(TABLE_DESC[t]));
    else P('_Descripción pendiente._');
    P();
    P('| Columna | Tipo | Nulo | Default | Descripción |');
    P('|---|---|---|---|---|');
    for (const c of cols) {
      P(`| \`${c.column_name}\` | ${typeOf(c)} | ${c.is_nullable === 'YES' ? 'sí' : 'no'} | ${fmtDef(c.column_default)} | ${esc(colDesc(c))} |`);
    }
    const tb = fkMap[t];
    if (tb?.length) P(`\n**Claves foráneas:** ${tb.map((f) => `\`${f.column_name}\` → \`${f.ref_table}.${f.ref_column}\`${f.delete_rule && f.delete_rule !== 'NO ACTION' ? ` (ON DELETE ${f.delete_rule})` : ''}`).join('; ')}`);
    const ib = idxMap[t];
    if (ib?.length) {
      P(`\n**Índices:**`);
      for (const ix of ib) P(`- \`${ix.indexdef.replace(/^CREATE (UNIQUE )?INDEX [^ ]+ ON /, '$1')}\``);
    }
    P();
  }
}

if (others.length) {
  P('### Otras tablas');
  P();
  for (const t of others) {
    const cols = byTable[t];
    P(`#### \`${t}\` — ${counts[t]?.toLocaleString('es-CO') ?? '?'} filas`);
    P();
    if (TABLE_DESC[t]) P(esc(TABLE_DESC[t]));
    P();
    P('| Columna | Tipo | Nulo | Default |');
    P('|---|---|---|---|');
    for (const c of cols) P(`| \`${c.column_name}\` | ${typeOf(c)} | ${c.is_nullable === 'YES' ? 'sí' : 'no'} | ${fmtDef(c.column_default)} |`);
    P();
  }
}

P('---');
P();
P('_Nota: este documento se regenera con `node scripts-agent/gen-db-docs.mjs`. Las descripciones marcadas como “pendiente” pueden completarse en el diccionario del generador._');

mkdirSync(dirname(OUT_MD), { recursive: true });
writeFileSync(OUT_MD, lines.join('\n') + '\n', 'utf8');

const schemaJson = {
  generatedAt: new Date().toISOString(),
  database: 'ecommerce',
  tables: Object.fromEntries(
    tableList.map((t) => [
      t,
      {
        description: TABLE_DESC[t] ?? null,
        rowCount: counts[t],
        columns: byTable[t].map((c) => ({
          name: c.column_name, type: typeOf(c), nullable: c.is_nullable === 'YES',
          default: c.column_default, description: colDesc(c) || null,
        })),
        primaryKey: pkMap[t] ?? [],
        foreignKeys: fkMap[t] ?? [],
        indexes: (idxMap[t] ?? []).map((i) => i.indexdef),
      },
    ]),
  ),
};
writeFileSync(OUT_JSON, JSON.stringify(schemaJson, null, 2), 'utf8');

await client.end();

const pending = Object.keys(byTable).filter((t) => !TABLE_DESC[t]);
console.log(`OK -> ${OUT_MD} (${lines.length} líneas)`);
console.log(`OK -> ${OUT_JSON}`);
console.log(`Tablas: ${tableList.length} | columnas: ${totalCols}`);
console.log(`Sin descripción de tabla: ${pending.length ? pending.join(', ') : 'ninguna'}`);
