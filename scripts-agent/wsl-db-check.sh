#!/bin/bash
set -e
/usr/bin/docker exec ecommerce_postgres psql -U postgres -d ecommerce -tAc \
  "select 'products=' || count(*) from products union all select 'orders=' || count(*) from orders;"
/usr/bin/docker network create mercaldas_internal >/dev/null 2>&1 || true
/usr/bin/docker network connect mercaldas_internal ecommerce_postgres >/dev/null 2>&1 || true
/usr/bin/docker network ls --format '{{.Name}}' | grep mercaldas || true
