#!/bin/bash
echo '--- procesos ---'
ps aux | grep -E 'node|prod\.js|docker compose|buildkit' | grep -v grep || true
echo '--- log ---'
if [ -f /tmp/prod-deploy.log ]; then
  ls -la /tmp/prod-deploy.log
  tail -n 30 /tmp/prod-deploy.log
else
  echo 'no existe /tmp/prod-deploy.log'
  ls -la /tmp | head -20
fi
