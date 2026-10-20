#!/bin/bash
set -e
B=/mnt/c/Users/Desarrolo4/Documents/ecommerce/db/backups/ecommerce/backup_2026-10-08
cat "$B"/ecommerce.dump.part-* > /tmp/ecom.dump
sha256sum /tmp/ecom.dump
/usr/bin/docker cp /tmp/ecom.dump ecommerce_postgres:/tmp/ecom.dump
echo '--- TOC (primeras 30) ---'
/usr/bin/docker exec ecommerce_postgres pg_restore -l /tmp/ecom.dump | head -30
echo '--- tablas actuales ---'
/usr/bin/docker exec ecommerce_postgres psql -U postgres -d ecommerce -c '\dt'
