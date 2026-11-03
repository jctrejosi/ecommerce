#!/usr/bin/env bash
# ============================================================
# Despliegue de producción del ecommerce en el servidor (Docker, Debian).
#
# Uso:
#   bash deploy/deploy.sh                 # despliega origin/dev
#   bash deploy/deploy.sh <sha|ref>       # despliega un commit/ref concreto
#   DEPLOY_PATH=/ruta bash deploy/deploy.sh
#
# Lo usan tanto GitHub Actions (runner self-hosted) como el operador a mano.
# Es idempotente: deja el checkout en `dev`, reconstruye la imagen `app`,
# la recrea y espera a que el healthcheck quede `healthy`.
#
# NO toca docker/.env ni los volúmenes: los secretos y los datos persisten.
# ============================================================
set -Eeuo pipefail

ROOT="${DEPLOY_PATH:-/home/deploy/ecommerce}"
TARGET="${1:-origin/dev}"
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
# Se desactivan los hooks: el hook de Git LFS falla si git-lfs no está instalado
# en WSL y haría fallar el checkout sin motivo (el repo no usa LFS para el
# despliegue).
git_here() {
  git -c safe.directory="$ROOT" -c core.hooksPath=/nonexistent -C "$ROOT" "$@"
}

log "Repositorio: $ROOT"
log "Objetivo   : $TARGET"

# SHA en el que estaba el checkout antes de moverlo (para detectar si cambió la
# configuración del edge compartido).
PREV_SHA="$(git_here rev-parse HEAD 2>/dev/null || true)"

# Trae siempre dev; el runner puede desplegar un SHA que llegó en el push.
git_here fetch --prune origin '+refs/heads/dev:refs/remotes/origin/dev'
git_here rev-parse --verify --quiet "$TARGET^{commit}" >/dev/null \
  || die "El commit/ref '$TARGET' no existe tras el fetch"

# Checkout determinista. -f descarta cambios locales en archivos versionados
# (en producción no se editan a mano); los archivos ignorados (.env, volúmenes)
# no se tocan.
git_here checkout -f -B dev "$TARGET"
COMMIT="$(git_here rev-parse --short=12 HEAD)"
SUBJECT="$(git_here log -1 --pretty=%s)"
log "Checkout en dev: $COMMIT — $SUBJECT"

# El Caddyfile del edge es un bind mount de ARCHIVO: si git lo reemplaza cambia
# el inodo y el contenedor deja de verlo. Se reinicia el edge cuando cambió.
if docker inspect edge_caddy >/dev/null 2>&1 && [[ -n "$PREV_SHA" ]]; then
  if ! git_here diff --quiet "$PREV_SHA" "$COMMIT" -- docker/edge/Caddyfile; then
    log "Cambió docker/edge/Caddyfile: reiniciando edge_caddy…"
    docker restart edge_caddy >/dev/null
    sleep 3
    docker exec edge_caddy caddy validate --config /etc/caddy/Caddyfile \
      || die "El Caddyfile del edge no valida"
    docker exec edge_caddy caddy reload --config /etc/caddy/Caddyfile \
      || die "No se pudo recargar el edge"
    log "Edge recargado."
  fi
fi

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
# El edge presenta el certificado de ORIGEN de Cloudflare (CA propia), que no
# está en el almacén del sistema; se valida con --cacert y no con -k.
# El healthcheck del contenedor pasa antes de que el edge pueda alcanzarlo, así
# que se reintenta unos segundos para no reportar un falso negativo.
if command -v curl >/dev/null 2>&1 && docker inspect edge_caddy >/dev/null 2>&1; then
  edge_ok=""
  for _ in $(seq 1 8); do
    if curl -fsS --max-time 10 --cacert /etc/mercaldas/edge-tls/origin.pem \
        --resolve mercaldas.jcti.xyz:443:127.0.0.1 \
        "$PUBLIC_HEALTH_URL" >/dev/null 2>&1; then
      edge_ok=1
      break
    fi
    sleep 3
  done
  if [[ -n "$edge_ok" ]]; then
    log "HTTPS público OK: $PUBLIC_HEALTH_URL"
  else
    warn "El contenedor está sano, pero $PUBLIC_HEALTH_URL no respondió por el edge."
  fi
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
log "Despliegue completado: $COMMIT"
