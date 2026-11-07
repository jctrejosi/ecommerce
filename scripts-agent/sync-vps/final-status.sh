#!/usr/bin/env bash
set -u
rm -f /tmp/sync-export/*.csv /tmp/active_paths.txt /tmp/active_missing.txt 2>/dev/null
rmdir /tmp/sync-export 2>/dev/null || true
docker inspect -f 'app={{.State.Health.Status}}' mercaldas_app
docker exec ecommerce_postgres psql -U postgres -d ecommerce -Atc "select 'activos='||count(*) from products where is_active union all select 'categorias='||count(*) from categories union all select 'pc='||count(*) from product_categories union all select 'media='||count(*) from media union all select 'pimg='||count(*) from product_images union all select 'outbox='||count(*) from erp_outbox"
