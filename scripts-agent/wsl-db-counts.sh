#!/bin/bash
set -e
/usr/bin/docker exec ecommerce_postgres psql -U postgres -d ecommerce -tAc \
  "select 'products=' || count(*) from products union all select 'orders=' || count(*) from orders union all select 'users=' || count(*) from users;"
echo -n 'ultimo_pedido='
/usr/bin/docker exec ecommerce_postgres psql -U postgres -d ecommerce -tAc \
  "select max(created_at)::date from orders;" 2>/dev/null || echo '(sin columna created_at)'
