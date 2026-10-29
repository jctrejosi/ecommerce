-- Aplica el delta de catálogo local → servidor.
-- TODO en una transacción y con app.erp_sync='on' para que NINGÚN trigger
-- encole nada hacia el ERP (erp_outbox no se toca).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL app.erp_sync = 'on';

-- 1) media nuevas: sin id explícito (la secuencia del servidor manda) y mapa
--    local→servidor por checksum (UNIQUE), que además cubre las que ya existan.
INSERT INTO media (status, media_type, provider, path, file_name, mime_type,
                   size_bytes, width, height, checksum, alt_text, is_public)
SELECT s.status::media_status_enum, s.media_type::media_type_enum, s.provider,
       s.path, s.file_name, s.mime_type, s.size_bytes, s.width, s.height,
       s.checksum, s.alt_text, coalesce(s.is_public, true)
FROM sync_stg.media s
WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.checksum = s.checksum);

INSERT INTO sync_stg.media_map (local_id, server_id)
SELECT s.id, m.id FROM sync_stg.media s JOIN media m ON m.checksum = s.checksum;

-- 2) categorías nuevas (sin padre en la primera pasada para no chocar con la FK)
INSERT INTO categories (id, parent_id, name, display_order, slug, code, level,
                        image_media_id, is_active, created_at, updated_at)
SELECT s.id, NULL, s.name, s.display_order, s.slug, s.code, s.level,
       mm.server_id, coalesce(s.is_active, true), now(), now()
FROM sync_stg.categories s
LEFT JOIN sync_stg.media_map mm ON mm.local_id = s.image_media_id
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = s.id);

UPDATE categories c
SET parent_id = s.parent_id
FROM sync_stg.categories s
WHERE c.id = s.id AND c.parent_id IS DISTINCT FROM s.parent_id;

-- 3) categorías existentes: estado, jerarquía, textos e ícono
UPDATE categories c
SET is_active    = s.is_active,
    name         = s.name,
    slug         = s.slug,
    level        = s.level,
    display_order= s.display_order,
    deleted_at   = s.deleted_at,
    image_media_id = coalesce(mm.server_id, s.image_media_id),
    updated_at   = now()
FROM sync_stg.categories s
LEFT JOIN sync_stg.media_map mm ON mm.local_id = s.image_media_id
WHERE c.id = s.id
  AND (c.is_active IS DISTINCT FROM s.is_active
    OR c.name IS DISTINCT FROM s.name
    OR c.slug IS DISTINCT FROM s.slug
    OR c.level IS DISTINCT FROM s.level
    OR c.display_order IS DISTINCT FROM s.display_order
    OR c.deleted_at IS DISTINCT FROM s.deleted_at
    OR c.image_media_id IS DISTINCT FROM coalesce(mm.server_id, s.image_media_id));

-- 4) estado de los productos
UPDATE products p
SET is_active = s.is_active,
    updated_at = now()
FROM sync_stg.products s
WHERE p.id = s.id AND p.is_active IS DISTINCT FROM s.is_active;

-- 5) product_categories: espejo exacto del local
DELETE FROM product_categories pc
WHERE NOT EXISTS (
  SELECT 1 FROM sync_stg.product_categories s
  WHERE s.product_id = pc.product_id AND s.category_id = pc.category_id
);

INSERT INTO product_categories (product_id, category_id)
SELECT s.product_id, s.category_id
FROM sync_stg.product_categories s
ON CONFLICT DO NOTHING;

-- 6) product_images nuevas (sin duplicar y respetando el índice único de portada)
INSERT INTO product_images (product_id, media_id, is_cover, position, created_at, updated_at)
SELECT s.product_id, mm.server_id,
       CASE WHEN s.is_cover AND NOT EXISTS (
              SELECT 1 FROM product_images c
              WHERE c.product_id = s.product_id AND c.is_cover) THEN true
            ELSE false END,
       s.position, now(), now()
FROM sync_stg.product_images s
JOIN sync_stg.media_map mm ON mm.local_id = s.media_id
WHERE NOT EXISTS (
  SELECT 1 FROM product_images pi
  WHERE pi.product_id = s.product_id AND pi.media_id = mm.server_id
);

-- 7) setting del carrusel
INSERT INTO settings (key, value, description, data_type, is_editable, is_public, module)
SELECT 'landing_categories',
       (SELECT value::jsonb FROM sync_stg.settings WHERE key = 'landing_categories'),
       'Categorías raíz del carrusel "Nuestros productos" (orden incluido)',
       'json', true, true, 'landing'
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now();

-- 8) secuencias al día
SELECT setval(pg_get_serial_sequence('media', 'id'), (SELECT max(id) FROM media));
SELECT setval(pg_get_serial_sequence('product_images', 'id'), (SELECT max(id) FROM product_images));
SELECT setval(pg_get_serial_sequence('categories', 'id'), (SELECT max(id) FROM categories));

COMMIT;
