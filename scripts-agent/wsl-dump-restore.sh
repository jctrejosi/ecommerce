#!/bin/bash
set -uo pipefail
echo '--- tablas en el dump ---'
/usr/bin/docker exec ecommerce_postgres pg_restore -l /tmp/ecom.dump | grep -E 'TABLE (DATA )?public\.' | head -20
echo '--- restaurando ---'
/usr/bin/docker exec ecommerce_postgres pg_restore -U postgres -d ecommerce --clean --if-exists --no-owner --no-privileges /tmp/ecom.dump > /tmp/restore.log 2>&1
echo "pg_restore exit=$?"
tail -30 /tmp/restore.log
echo '--- conteos ---'
/usr/bin/docker exec ecommerce_postgres psql -U postgres -d ecommerce -tAc "select 'products=' || count(*) from products union all select 'orders=' || count(*) from orders;" 2>&1
