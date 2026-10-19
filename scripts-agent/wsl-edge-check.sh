#!/bin/bash
echo "started=$(/usr/bin/docker inspect --format '{{.State.StartedAt}}' edge_caddy)"
echo '--- ultimos staging ---'
/usr/bin/docker logs --tail 400 edge_caddy 2>&1 | grep -i staging | tail -3 || true
echo '--- config en ejecucion ---'
/usr/bin/docker exec edge_caddy sh -c 'wget -qO- http://localhost:2019/config/ 2>/dev/null' > /tmp/edge-config.json
tr ',' '\n' < /tmp/edge-config.json | grep -iE 'staging|acme' | head -10 || true
echo '--- caddyfile ---'
/usr/bin/docker exec edge_caddy grep -n 'acme_ca' /etc/caddy/Caddyfile || true
