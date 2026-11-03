#!/bin/sh
# ufw: 80/443 solo desde Cloudflare (ruta INPUT, complementa DOCKER-USER).
set -u
PATH=/usr/sbin:/sbin:/usr/bin:/bin

CF4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22"
CF6="2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32"

# Quitar los "allow anywhere" (v4 y v6: dos borrados por puerto).
for p in 80 443; do
  ufw --force delete allow "$p/tcp" >/dev/null 2>&1
  ufw --force delete allow "$p/tcp" >/dev/null 2>&1
done

for cidr in $CF4 $CF6; do
  ufw allow from "$cidr" to any port 80 proto tcp comment 'Cloudflare' >/dev/null
  ufw allow from "$cidr" to any port 443 proto tcp comment 'Cloudflare' >/dev/null
done

ufw --force reload >/dev/null 2>&1
echo "ufw: 80/443 solo desde Cloudflare"
