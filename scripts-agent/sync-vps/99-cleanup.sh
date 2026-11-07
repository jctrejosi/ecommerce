#!/usr/bin/env bash
# Limpieza del staging temporal y de los archivos de export en el servidor.
set -u
docker exec -i ecommerce_postgres psql -U postgres -d ecommerce -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS sync_stg CASCADE;'
rm -f /tmp/sync-export/*.csv /tmp/active_paths.txt /tmp/active_missing.txt
rmdir /tmp/sync-export 2>/dev/null || true

echo "--- estado final ---"
docker inspect -f 'app={{.State.Health.Status}} imagen={{.Image}}' mercaldas_app
docker exec ecommerce_postgres psql -U postgres -d ecommerce -Atc \
  "select 'activos='||count(*) from products where is_active union all
   select 'categorias='||count(*) from categories union all
   select 'product_categories='||count(*) from product_categories union all
   select 'media='||count(*) from media union all
   select 'product_images='||count(*) from product_images union all
   select 'outbox_total='||count(*) from erp_outbox"
