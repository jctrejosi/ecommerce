#!/usr/bin/env bash
# ============================================================
# Convierte un directorio desplegado a mano (sin .git) en un checkout git de
# una rama, SIN perder archivos no versionados (.env, datos, estáticos).
#
# Uso:
#   sudo -u deploy bash deploy/ci/adopt-checkout.sh <dir> <repo_url> [branch] [--apply]
#
# Sin --apply solo simula (clona en un directorio temporal) e informa:
#   - CAMBIARÍA: archivo versionado cuyo contenido local difiere del repo,
#   - FALTARÍA : archivo versionado que no está en disco.
#
# Con --apply ejecuta git init + remote + fetch + reset --hard.
# `reset --hard` únicamente reescribe rutas versionadas; NO borra lo que git no
# conoce (variables de entorno, volúmenes, imágenes subidas a mano), que queda
# como "sin versionar".
#
# Requisito: la clave SSH de /home/deploy/.ssh/id_github ya autorizada en GitHub.
# Motivo: deploy/deploy.sh necesita `git fetch` + `git checkout`, así que el
# directorio desplegado tiene que ser un clon real.
# ============================================================
set -Eeuo pipefail

DIR="${1:-}"
REPO_URL="${2:-}"
BRANCH="${3:-dev}"
MODE="${4:-}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ -n "$DIR" && -n "$REPO_URL" ]] \
  || die "Uso: bash $0 <dir> <repo_url> [branch] [--apply]"
[[ -d "$DIR" ]] || die "No existe el directorio $DIR"
[[ -d "$DIR/.git" ]] && die "$DIR ya es un repositorio git"
command -v git >/dev/null || die "git no está instalado"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

printf '==> Clonando referencia %s (%s)…\n' "$BRANCH" "$REPO_URL"
git clone --quiet --bare --branch "$BRANCH" "$REPO_URL" "$WORK/repo.git" \
  || die "No pude clonar $REPO_URL ($BRANCH). ¿Falta autorizar la clave SSH en GitHub?"

printf '==> Comparando con %s\n' "$DIR"
changed=0
while IFS= read -r -d '' entry; do
  meta="${entry%%$'\t'*}"
  path="${entry#*$'\t'}"
  hash="${meta##* }"
  if [[ -f "$DIR/$path" ]]; then
    actual="$(git -C "$WORK/repo.git" hash-object --no-filters -- "$DIR/$path")"
    if [[ "$actual" != "$hash" ]]; then
      printf 'CAMBIARÍA  %s\n' "$path"
      changed=$((changed + 1))
    fi
  else
    printf 'FALTARÍA   %s\n' "$path"
    changed=$((changed + 1))
  fi
done < <(git -C "$WORK/repo.git" ls-tree -r -z HEAD)

printf '==> Diferencias en archivos versionados: %s\n' "$changed"

if [[ "$MODE" != "--apply" ]]; then
  printf '==> Simulación. Reejecuta con --apply para convertir el directorio.\n'
  exit 0
fi

cd "$DIR"
git init --quiet
git remote add origin "$REPO_URL"
git fetch --quiet --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
git reset --hard --quiet "refs/remotes/origin/$BRANCH"

printf '\n==> Sin versionar (se conservan):\n'
git status --porcelain --untracked-files=all | head -40
printf '\n==> Listo: %s en %s (%s)\n' "$DIR" "$BRANCH" "$(git rev-parse --short HEAD)"
