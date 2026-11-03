#!/usr/bin/env bash
# ============================================================
# Auto-despliegue por sondeo (sin runners ni tokens de GitHub).
#
# Cada pasada, para cada proyecto:
#   1. `git fetch` de origin/dev,
#   2. compara HEAD con origin/dev,
#   3. si cambió, ejecuta deploy/deploy.sh origin/dev.
#
# Lo lanza jcti-autodeploy.timer cada 2 minutos. Un `flock` en la unit evita
# solapamientos, así que una pasada lenta (build de imagen) no se pisa con la
# siguiente.
#
# Características:
#   - Un proyecto roto no bloquea a los demás (se registra y se sigue).
#   - Si el build falla, deploy.sh aborta ANTES de recrear el contenedor: el
#     servicio sigue con la versión anterior.
#   - No toca .env ni volúmenes (siguen siendo archivos no versionados).
#
# OJO: `git checkout -f -B dev` descarta ediciones locales de archivos
# versionados. La configuración vive en el repo, no en el servidor.
# ============================================================
set -uo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME="${HOME:-/home/deploy}"
export GIT_TERMINAL_PROMPT=0

PROJECTS="${AUTODEPLOY_PROJECTS:-ecommerce crm whatsapp-bot-platform restaurants Astaroth Paimon}"
BASE="${AUTODEPLOY_BASE:-/home/deploy}"

stamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log()   { printf '[autodeploy %s] %s\n' "$(stamp)" "$*"; }

failed=0
deployed=""

for name in $PROJECTS; do
  dir="$BASE/$name"

  if [[ ! -d "$dir/.git" ]]; then
    log "$name: sin clon git, se omite"
    continue
  fi
  if [[ ! -x "$dir/deploy/deploy.sh" ]]; then
    log "$name: sin deploy/deploy.sh, se omite"
    continue
  fi

  if ! git -C "$dir" fetch --quiet --prune origin \
      '+refs/heads/dev:refs/remotes/origin/dev' 2>/dev/null; then
    log "$name: fallo el fetch (¿red o clave SSH?)"
    failed=1
    continue
  fi

  local_sha="$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)"
  remote_sha="$(git -C "$dir" rev-parse 'refs/remotes/origin/dev' 2>/dev/null || true)"

  if [[ -z "$remote_sha" ]]; then
    log "$name: no pude resolver origin/dev"
    failed=1
    continue
  fi
  if [[ "$local_sha" == "$remote_sha" ]]; then
    continue
  fi

  log "$name: cambio detectado ${local_sha:0:12} -> ${remote_sha:0:12}, desplegando"
  if bash "$dir/deploy/deploy.sh" origin/dev; then
    deployed="$deployed $name"
    log "$name: desplegado"
  else
    log "$name: EL DESPLIEGUE FALLÓ (el servicio sigue con la versión anterior)"
    failed=1
  fi
done

if [[ -n "$deployed" ]]; then
  log "resumen: desplegados ->$deployed"
fi
exit "$failed"
