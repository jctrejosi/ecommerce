#!/bin/bash
set -e
REPO=/mnt/c/Users/Desarrolo4/Documents/ecommerce
rm -f /tmp/prod-deploy.log
systemctl reset-failed mercaldas-deploy 2>/dev/null || true
systemd-run --unit=mercaldas-deploy --collect \
  --property=WorkingDirectory="$REPO" \
  --property=StandardOutput=append:/tmp/prod-deploy.log \
  --property=StandardError=append:/tmp/prod-deploy.log \
  /usr/bin/node prod.js --with-db
sleep 3
systemctl is-active mercaldas-deploy || true
tail -n 10 /tmp/prod-deploy.log 2>/dev/null || true
