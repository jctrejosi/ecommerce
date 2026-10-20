#!/usr/bin/env bash
# ============================================================
# Despliegue de producción del ecommerce en el VPS (WSL + Docker).
#
# Uso:
#   bash deploy/deploy.sh                 # despliega origin/master
#   bash deploy/deploy.sh <sha|ref>       # despliega un commit/ref concreto
#   DEPLOY_PATH=/ruta bash deploy/deploy.sh
#
# Lo usan tanto GitHub Actions (runner self-hosted) como el operador a mano.
# Es idempotente: deja el checkout en `master`, reconstruye la imagen `app`,
# la recrea y espera a que el healthcheck quede `healthy`.
#
# NO toca docker/.env ni los volúmenes: los secretos y los datos persisten.
# ============================================================
set -Eeuo pipefail

ROOT="${DEPLOY_PATH:-/mnt/c/Users/Desarrolo4/Documents/ecommerce}"
TARGET="${1:-origin/master}"
COMPOSE_FILE="$ROOT/docker/docker-compose.yml"
ENV_FILE="$ROOT/docker/.env"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://mercaldas.jcti.xyz/api-status}"

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }
log()  { printf '[deploy %s] %s\n' "$(timestamp)" "$*"; }
warn() { printf '[deploy %s] AVISO: %s\n' "$(timestamp)" "$*" >&2; }
die()  { printf '[deploy %s] ERROR: %s\n' "$(timestamp)" "$*" >&2; exit 1; }

cd "$ROOT" 2>/dev/null || die "No existe DEPLOY_PATH=$ROOT"
[[ -f "$COMPOSE_FILE" ]] || die "Falta $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]]     || die "Falta $ENV_FILE (cópialo de docker/.env.example y configura secretos)"
command -v git    >/dev/null || die "git no está instalado"
command -v docker >/dev/null || die "docker no está en PATH"
docker info >/dev/null 2>&1 || die "Docker no responde (revisa systemctl status docker)"

# El .git/config de este checkout apunta al ssh.exe de Windows (heredado), que
# no existe dentro de WSL. Si está disponible la clave de despliegue, se usa
# solo para este proceso; la configuración de Git de Windows no se modifica.
GIT_SSH_KEY="${GIT_SSH_KEY:-/etc/mercaldas/deploy_key}"
if [[ -r "$GIT_SSH_KEY" ]]; then
  export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -i $GIT_SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new}"
fi

# El checkout de producción puede pertenecer a otro usuario de Windows; se le
# indica a git que ese directorio es de confianza solo para estos comandos.
git_here() { git -c safe.directory="$ROOT" -C "$ROOT" "$@"; }

log "Repositorio: $ROOT"
log "Objetivo   : $TARGET"

# Trae siempre master; el runner puede desplegar un SHA que llegó en el push.
git_here fetch --prune origin '+refs/heads/master:refs/remotes/origin/master'
git_here rev-parse --verify --quiet "$TARGET^{commit}" >/dev/null \
  || die "El commit/ref '$TARGET' no existe tras el fetch"

# Checkout determinista. -f descarta cambios locales en archivos versionados
# (en producción no se editan a mano); los archivos ignorados (.env, volúmenes)
# no se tocan.
git_here checkout -f -B master "$TARGET"
COMMIT="$(git_here rev-parse --short=12 HEAD)"
SUBJECT="$(git_here log -1 --pretty=%s)"
log "Checkout en master: $COMMIT — $SUBJECT"

# Valida que el compose y el .env sean coherentes antes de construir.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet \
  || die "docker compose config falló (revisa $ENV_FILE)"

log "Construyendo imagen mercaldas/app:latest…"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build app

log "Recreando el contenedor de la app (sin tocar OSRM ni la BD)…"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  up -d --no-deps --force-recreate app

log "Esperando healthcheck de mercaldas_app…"
STATUS=""
for _ in $(seq 1 60); do
  STATUS="$(docker inspect -f \
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    mercaldas_app 2>/dev/null || true)"
  case "$STATUS" in
    healthy)
      log "Contenedor healthy."
      break
      ;;
    unhealthy|exited|dead)
      docker logs --tail 120 mercaldas_app 2>&1 || true
      die "El contenedor quedó en estado '$STATUS'."
      ;;
  esac
  sleep 5
done

if [[ "$STATUS" != "healthy" ]]; then
  docker logs --tail 120 mercaldas_app 2>&1 || true
  die "Timeout esperando healthy (último estado: '${STATUS:-desconocido}')."
fi

# Comprobación opcional de punta a punta a través del edge compartido. Un fallo
# aquí es un aviso: el contenedor ya está sano y el edge puede ser de otro
# proyecto o estar reiniciando.
if command -v curl >/dev/null 2>&1 && docker inspect edge_caddy >/dev/null 2>&1; then
  if curl -fsS --max-time 10 \
      --resolve mercaldas.jcti.xyz:443:127.0.0.1 \
      "$PUBLIC_HEALTH_URL" >/dev/null 2>&1; then
    log "HTTPS público OK: $PUBLIC_HEALTH_URL"
  else
    warn "El contenedor está sano, pero $PUBLIC_HEALTH_URL no respondió por el edge."
  fi
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
log "Despliegue completado: $COMMIT"
