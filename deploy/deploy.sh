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
# Es idempotente: deja el checkout en `dev`, reconstruye las imágenes del
# proyecto compose `ecommerce` (backend, bot, 4 SPAs y proxy), recrea los
# contenedores y espera a que el backend quede `healthy`.
#
# NO toca docker/.env ni los volúmenes: los secretos y los datos persisten.
# ============================================================
set -Eeuo pipefail

ROOT="${DEPLOY_PATH:-/home/deploy/ecommerce}"
TARGET="${1:-origin/dev}"
COMPOSE_FILE="$ROOT/docker/docker-compose.yml"
ENV_FILE="$ROOT/docker/.env"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://ecommerce.jcti.xyz/api-status}"
PUBLIC_HEALTH_HOST="${PUBLIC_HEALTH_HOST:-ecommerce.jcti.xyz}"
EDGE_SITES_DIR="${EDGE_SITES_DIR:-/home/deploy/edge/sites}"

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

# Si está disponible la clave de despliegue, se usa solo para este proceso.
GIT_SSH_KEY="${GIT_SSH_KEY:-/etc/mercaldas/deploy_key}"
if [[ -r "$GIT_SSH_KEY" ]]; then
  export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -i $GIT_SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new}"
fi

# Se desactivan los hooks: si git-lfs no está instalado en el servidor, el
# hook fallaría el checkout sin motivo.
git_here() {
  git -c safe.directory="$ROOT" -c core.hooksPath=/nonexistent -C "$ROOT" "$@"
}

log "Repositorio: $ROOT"
log "Objetivo   : $TARGET"

PREV_SHA="$(git_here rev-parse HEAD 2>/dev/null || true)"

git_here fetch --prune origin '+refs/heads/dev:refs/remotes/origin/dev'
git_here rev-parse --verify --quiet "$TARGET^{commit}" >/dev/null \
  || die "El commit/ref '$TARGET' no existe tras el fetch"

# Checkout determinista. -f descarta cambios locales en archivos versionados
# (en producción no se editan a mano); los ignorados (.env, volúmenes) no se tocan.
git_here checkout -f -B dev "$TARGET"
COMMIT="$(git_here rev-parse --short=12 HEAD)"
SUBJECT="$(git_here log -1 --pretty=%s)"
log "Checkout en dev: $COMMIT — $SUBJECT"

# ── Host del ecommerce en el edge compartido ────────────────────────────────
# El Caddyfile del edge es infraestructura (/home/deploy/edge), pero el bloque
# de este proyecto se versiona aquí. Si cambió, se copia y se recarga.
EDGE_SITE_SRC="$ROOT/docker/edge/sites/ecommerce.caddy"
EDGE_SITE_DST="$EDGE_SITES_DIR/ecommerce.caddy"
if [[ -f "$EDGE_SITE_SRC" && -d "$EDGE_SITES_DIR" ]]; then
  CHANGED=0
  if [[ ! -f "$EDGE_SITE_DST" ]]; then
    CHANGED=1
  elif [[ -n "$PREV_SHA" ]] && ! git_here diff --quiet "$PREV_SHA" "$COMMIT" -- docker/edge/sites/ecommerce.caddy; then
    CHANGED=1
  fi
  if [[ "$CHANGED" == "1" ]]; then
    log "Sincronizando $EDGE_SITE_DST…"
    install -m 0644 "$EDGE_SITE_SRC" "$EDGE_SITE_DST"
    if docker inspect edge_caddy >/dev/null 2>&1; then
      docker exec edge_caddy caddy reload --config /etc/caddy/Caddyfile \
        || warn "No se pudo recargar edge_caddy (¿está arriba?)"
    fi
  fi
else
  warn "No encontré $EDGE_SITE_SRC o $EDGE_SITES_DIR; no se toca el edge."
fi

# Valida que el compose y el .env sean coherentes antes de construir.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet \
  || die "docker compose config falló (revisa $ENV_FILE)"

log "Construyendo imágenes del proyecto ecommerce…"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build

log "Recreando contenedores (la BD y los volúmenes se conservan)…"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  up -d --remove-orphans

log "Esperando healthcheck de ecommerce_backend…"
STATUS=""
for _ in $(seq 1 60); do
  STATUS="$(docker inspect -f \
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    ecommerce_backend 2>/dev/null || true)"
  case "$STATUS" in
    healthy)
      log "Backend healthy."
      break
      ;;
    unhealthy|exited|dead)
      docker logs --tail 120 ecommerce_backend 2>&1 || true
      die "El backend quedó en estado '$STATUS'."
      ;;
  esac
  sleep 5
done

if [[ "$STATUS" != "healthy" ]]; then
  docker logs --tail 120 ecommerce_backend 2>&1 || true
  die "Timeout esperando healthy (último estado: '${STATUS:-desconocido}')."
fi

# Comprobación de punta a punta a través del edge compartido. Un fallo aquí es
# un aviso: los contenedores ya están sanos y el edge puede estar reiniciando.
# El edge presenta el certificado de ORIGEN de Cloudflare (CA propia), que no
# está en el almacén del sistema; se valida con --cacert y no con -k.
if command -v curl >/dev/null 2>&1 && docker inspect edge_caddy >/dev/null 2>&1; then
  edge_ok=""
  for _ in $(seq 1 8); do
    if curl -fsS --max-time 10 --cacert /etc/mercaldas/edge-tls/origin.pem \
        --resolve "$PUBLIC_HEALTH_HOST:443:127.0.0.1" \
        "$PUBLIC_HEALTH_URL" >/dev/null 2>&1; then
      edge_ok=1
      break
    fi
    sleep 3
  done
  if [[ -n "$edge_ok" ]]; then
    log "HTTPS público OK: $PUBLIC_HEALTH_URL"
  else
    warn "Los contenedores están sanos, pero $PUBLIC_HEALTH_URL no respondió por el edge."
  fi
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
log "Despliegue completado: $COMMIT"
