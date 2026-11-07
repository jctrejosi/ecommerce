#!/usr/bin/env bash
# Recon del servidor (sin git status, que es lentísimo sobre /mnt/c).
set -u

echo "=== contenedores ==="
timeout 60 docker ps --format '{{.Names}}\t{{.Status}}' | head -20

echo "=== volumen media ==="
VOL=/var/lib/docker/volumes/mercaldas_media/_data
if [ -d "$VOL" ]; then
  echo "raiz: $(ls -1 "$VOL" | head -20 | tr '\n' ' ')"
  echo "dirs products: $(ls -1 "$VOL/images_static/media/products" 2>/dev/null | wc -l)"
  echo "archivos products: $(timeout 120 find "$VOL/images_static/media/products" -type f 2>/dev/null | wc -l)"
  echo "archivos categories: $(timeout 60 find "$VOL/images_static/media/categories" -type f 2>/dev/null | wc -l)"
  timeout 120 du -sh "$VOL" 2>/dev/null
else
  echo "NO existe $VOL"
fi

echo "=== media env del contenedor ==="
timeout 30 docker inspect mercaldas_app --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -i -E 'media|static|upload' | head -10

echo "=== db ==="
timeout 60 docker exec ecommerce_postgres psql -U postgres -d ecommerce -Atc \
 "select 'categories', count(*) from categories union all
  select 'categories_vtex', count(*) from categories where code like 'V%' and deleted_at is null union all
  select 'products', count(*) from products union all
  select 'products_active', count(*) from products where is_active union all
  select 'product_categories', count(*) from product_categories union all
  select 'media', count(*) from media union all
  select 'product_images', count(*) from product_images" 2>&1 | head -20
echo "=== fin ==="
