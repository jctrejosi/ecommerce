#!/bin/bash
echo '--- primeras lineas tras recreate ---'
/usr/bin/docker logs edge_caddy 2>&1 | head -30
echo '--- caddy environ ---'
/usr/bin/docker exec edge_caddy caddy environ 2>&1 | grep -iE 'acme|caddy|ca' | head -20
echo '--- adapt issuers ---'
/usr/bin/docker exec edge_caddy caddy adapt --config /etc/caddy/Caddyfile 2>/dev/null | tr '{' '\n' | grep -iE 'ca|issuer' | head -20
echo '--- admin api ---'
/usr/bin/docker exec edge_caddy sh -c 'command -v wget; command -v curl; wget -qO- http://127.0.0.1:2019/config/ 2>&1 | head -c 300'
