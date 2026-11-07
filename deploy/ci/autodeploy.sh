#!/usr/bin/env bash
# ============================================================
# Auto-despliegue por sondeo (sin runners ni tokens de GitHub).
#
# Cada pasada, para cada proyecto:
#   1. `git fetch` de origin/dev,
#   2. compara origin/dev con el ÚLTIMO SHA DESPLEGADO CON ÉXITO,
#   3. si cambió, ejecuta deploy/deploy.sh origin/dev.
#
# Lo lanza jcti-autodeploy.timer cada 2 minutos. Un `flock` en la unit evita
# solapamientos, así que una pasada lenta (build de imagen) no se pisa con la
# siguiente.
#
# Estado: /home/deploy/.autodeploy/<proyecto>.ok guarda el SHA que quedó
# desplegado. Se usa este archivo y no `git rev-parse HEAD` porque deploy.sh
# hace el checkout ANTES de construir: si el build falla, HEAD ya apunta al
# commit nuevo y el sondeo no volvería a intentarlo nunca.
#
# Un commit que falla no se reintenta en bucle (sería un build cada 2 min):
# se anota en <proyecto>.failed y se espera a un push nuevo o a un despliegue
# manual.
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
STATE="${AUTODEPLOY_STATE:-$HOME/.autodeploy}"

stamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log()   { printf '[autodeploy %s] %s\n' "$(stamp)" "$*"; }

mkdir -p "$STATE" || { log "no pude crear $STATE"; exit 1; }

failed=0
deployed=""

for name in $PROJECTS; do
  dir="$BASE/$name"
  ok_file="$STATE/$name.ok"
  failed_file="$STATE/$name.failed"

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

  head_sha="$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)"
  remote_sha="$(git -C "$dir" rev-parse 'refs/remotes/origin/dev' 2>/dev/null || true)"

  if [[ -z "$remote_sha" ]]; then
    log "$name: no pude resolver origin/dev"
    failed=1
    continue
  fi

  # Sin estado previo se asume que HEAD ya está desplegado (primera pasada).
  deployed_sha="$(cat "$ok_file" 2>/dev/null || true)"
  if [[ -z "$deployed_sha" ]]; then
    deployed_sha="$head_sha"
    printf '%s\n' "$deployed_sha" > "$ok_file"
  fi

  if [[ "$deployed_sha" == "$remote_sha" ]]; then
    continue
  fi

  if [[ "$(cat "$failed_file" 2>/dev/null || true)" == "$remote_sha" ]]; then
    log "$name: ${remote_sha:0:12} ya falló antes; no se reintenta solo (push nuevo o deploy manual)"
    continue
  fi

  log "$name: cambio ${deployed_sha:0:12} -> ${remote_sha:0:12}, desplegando"
  if bash "$dir/deploy/deploy.sh" origin/dev; then
    printf '%s\n' "$remote_sha" > "$ok_file"
    rm -f "$failed_file"
    deployed="$deployed $name"
    log "$name: desplegado"
  else
    printf '%s\n' "$remote_sha" > "$failed_file"
    log "$name: EL DESPLIEGUE FALLÓ (revisa el log; se reintenta con un push nuevo o a mano)"
    failed=1
  fi
done

if [[ -n "$deployed" ]]; then
  log "resumen: desplegados ->$deployed"
fi
exit "$failed"
