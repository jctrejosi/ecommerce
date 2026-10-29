-- Esquema temporal de staging para el delta de catálogo local → servidor.
DROP SCHEMA IF EXISTS sync_stg CASCADE;
CREATE SCHEMA sync_stg;

CREATE TABLE sync_stg.categories (
  id bigint, parent_id bigint, name text, slug text, code text, level integer,
  display_order integer, image_media_id bigint, is_active boolean, deleted_at timestamptz
);

CREATE TABLE sync_stg.products (
  id bigint, is_active boolean, visibility text, is_public boolean, deleted_at timestamptz
);

CREATE TABLE sync_stg.product_categories (product_id bigint, category_id bigint);

CREATE TABLE sync_stg.media (
  id bigint, status text, media_type text, provider text, path text, file_name text,
  mime_type text, size_bytes bigint, width integer, height integer, checksum text,
  alt_text text, is_public boolean
);

CREATE TABLE sync_stg.product_images (
  id bigint, product_id bigint, media_id bigint, is_cover boolean, position integer
);

CREATE TABLE sync_stg.settings (key text, value text);

CREATE TABLE sync_stg.media_map (local_id bigint PRIMARY KEY, server_id bigint);
