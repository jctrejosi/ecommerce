#!/usr/bin/env bash
# Comprueba que cada imagen de producto ACTIVO tenga archivo en el volumen.
set -u
VOL=/var/lib/docker/volumes/mercaldas_media/_data

docker exec ecommerce_postgres psql -U postgres -d ecommerce -Atc "
  select distinct m.path
  from product_images pi
  join media m on m.id = pi.media_id
  join products p on p.id = pi.product_id
  where p.is_active and m.path is not null" > /tmp/active_paths.txt

total=$(wc -l < /tmp/active_paths.txt)
missing=0
: > /tmp/active_missing.txt
while IFS= read -r p; do
  rel=${p#/static/}
  case "$p" in
    http*) continue ;;
  esac
  if [ ! -f "$VOL/images_static/$rel" ]; then
    missing=$((missing + 1))
    printf '%s\n' "$p" >> /tmp/active_missing.txt
  fi
done < /tmp/active_paths.txt

echo "rutas distintas de imágenes de productos activos: $total"
echo "sin archivo en el volumen: $missing"
head -5 /tmp/active_missing.txt
