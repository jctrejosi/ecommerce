#!/bin/bash
cd /mnt/c/Users/Desarrolo4/Documents/ecommerce || exit 1
PASS=$(grep '^ADMIN_PASSWORD=' docker/.env | cut -d= -f2-)
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
echo "admin_anon=$(code -H 'Host: admin.mercaldas.jcti.xyz' http://127.0.0.1:30180/)"
echo "admin_auth=$(code -u "admin:${PASS}" -H 'Host: admin.mercaldas.jcti.xyz' http://127.0.0.1:30180/)"
echo "bot_anon=$(code -H 'Host: api.mercaldas.jcti.xyz' http://127.0.0.1:30180/bot/health)"
echo "bot_auth=$(code -u "admin:${PASS}" -H 'Host: api.mercaldas.jcti.xyz' http://127.0.0.1:30180/bot/health)"
