#!/usr/bin/env bash
# ============================================================
# Instala (o repara) UN runner self-hosted de GitHub Actions en el VPS.
#
# Uso, como root:
#   bash deploy/ci/install-runner.sh <slug> <repo_url> <registration_token>
#
# Ejemplo:
#   bash deploy/ci/install-runner.sh ecommerce \
#     https://github.com/jctrejosi/ecommerce <TOKEN>
#
# El token se genera en GitHub → repo → Settings → Actions → Runners →
# "New self-hosted runner" (Linux x64) y caduca en ~1 hora.
#
# Qué deja instalado:
#   - /home/deploy/.github-runners/<slug>   (binarios y _work del runner)
#   - servicio systemd actions.runner.<slug>.service, habilitado al arranque
#   - corre como el usuario `deploy` (dueño del código y del grupo docker),
#     que NO tiene sudo: el runner no necesita privilegios de root.
#   - labels: linux,mercaldas  (lo que esperan los workflows del monorepo)
#
# Es idempotente: si el runner ya existe, lo reconfigura con --replace.
# ============================================================
set -Eeuo pipefail

SLUG="${1:-}"
REPO_URL="${2:-}"
TOKEN="${3:-}"

RUNNER_USER="${RUNNER_USER:-deploy}"
RUNNER_BASE="${RUNNER_BASE:-/home/deploy/.github-runners}"
RUNNER_LABELS="${RUNNER_LABELS:-linux,mercaldas}"
RUNNER_VERSION="${RUNNER_VERSION:-}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '==> %s\n' "$*"; }

[[ -n "$SLUG" && -n "$REPO_URL" && -n "$TOKEN" ]] \
  || die "Uso: bash $0 <slug> <repo_url> <registration_token>"
[[ "$(id -u)" -eq 0 ]] || die "Ejecuta este script como root (sudo)."
[[ -d /run/systemd/system ]] || die "systemd no está activo."
id "$RUNNER_USER" >/dev/null 2>&1 || die "No existe el usuario $RUNNER_USER."
getent group docker >/dev/null 2>&1 || die "No existe el grupo docker."
id -nG "$RUNNER_USER" | grep -qw docker \
  || die "$RUNNER_USER no está en el grupo docker."

RUNNER_DIR="$RUNNER_BASE/$SLUG"
CACHE_DIR="/opt/actions-runner-cache"

log "Resolviendo versión del runner…"
if [[ -z "$RUNNER_VERSION" ]]; then
  RUNNER_VERSION="$(
    curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"].lstrip("v"))'
  )"
fi
[[ -n "$RUNNER_VERSION" ]] || die "No pude resolver RUNNER_VERSION."
log "Versión: $RUNNER_VERSION"

TGZ="$CACHE_DIR/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz"
if [[ ! -s "$TGZ" ]]; then
  log "Descargando $TGZ…"
  install -d -m 755 "$CACHE_DIR"
  curl -fL --retry 3 -o "$TGZ.part" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  mv "$TGZ.part" "$TGZ"
fi

# Si ya hay un servicio corriendo para este slug, se detiene antes de tocar
# los binarios (el tar sobrescribe archivos en uso).
if systemctl list-unit-files 'actions.runner.*.service' >/dev/null 2>&1; then
  while read -r unit; do
    [[ -n "$unit" ]] || continue
    if [[ "$unit" == *"$SLUG"* ]]; then
      log "Deteniendo $unit…"
      systemctl stop "$unit" || true
    fi
  done < <(systemctl list-unit-files --type=service --no-legend 'actions.runner.*' 2>/dev/null | awk '{print $1}')
fi

log "Extrayendo runner en $RUNNER_DIR…"
install -d -m 755 "$RUNNER_DIR"
tar -xzf "$TGZ" -C "$RUNNER_DIR"
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"

if [[ ! -x "$RUNNER_DIR/bin/Runner.Listener" ]]; then
  log "Instalando dependencias del runner…"
  "$RUNNER_DIR/bin/installdependencies.sh"
fi

log "Registrando $SLUG en $REPO_URL…"
su -s /bin/bash "$RUNNER_USER" -c \
  "cd '$RUNNER_DIR' && ./config.sh --url '$REPO_URL' --token '$TOKEN' \
     --name '${SLUG}-vps' --labels '$RUNNER_LABELS' --work '_work' \
     --unattended --replace"

log "Verificando acceso a Docker como $RUNNER_USER…"
su -s /bin/bash "$RUNNER_USER" -c "docker info >/dev/null" \
  || die "$RUNNER_USER no puede usar Docker."

log "Instalando servicio systemd…"
cd "$RUNNER_DIR"
./svc.sh install "$RUNNER_USER" >/dev/null
./svc.sh start
./svc.sh status || true

log "Runner '$SLUG' instalado."
printf 'Servicio: systemctl status actions.runner.*%s*\nLogs:     journalctl -u "actions.runner.*%s*" -f\n' \
  "$SLUG" "$SLUG"
