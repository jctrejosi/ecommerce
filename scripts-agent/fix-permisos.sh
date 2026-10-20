#!/usr/bin/env bash
#
# Corrige ownership/permisos de archivos que Docker crea como root dentro de
# ecommerce — sobre todo el grafo OSRM en delivery-routing/data, que genera
# ./prepare.sh corriendo el contenedor como root y luego bloquea la copia.
#
# Uso:
#   bash scripts-agent/fix-permisos.sh            # solo el grafo OSRM
#   bash scripts-agent/fix-permisos.sh --all      # todo ecommerce (recursivo)
#   bash scripts-agent/fix-permisos.sh --dir RUTA # un directorio concreto
#
# Pide sudo si hace falta. NUNCA guarda ni pide contraseñas en el archivo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="$(id -un)"
GRAPH_DIR="$ROOT/delivery-routing/data"
TARGET="$GRAPH_DIR"

case "${1:-}" in
  --all) TARGET="$ROOT" ;;
  --dir)
    [ -n "${2:-}" ] || { echo "✘ Falta la ruta: --dir RUTA"; exit 1; }
    TARGET="$(cd "$2" && pwd)"
    ;;
  "") ;;
  *) echo "✘ Opción desconocida: $1"; exit 1 ;;
esac

[ -e "$TARGET" ] || { echo "✘ No existe: $TARGET"; exit 1; }

echo "🔧 Corrigiendo ownership/permisos → $TARGET  (usuario: $USER_NAME)"
sudo chown -R "$USER_NAME:$USER_NAME" "$TARGET"
sudo chmod -R u+rwX "$TARGET"

# El grafo OSRM debe poder leerse por cualquiera (para copias); se normaliza a 644.
if [ -d "$GRAPH_DIR" ]; then
  find "$GRAPH_DIR" -type f -exec chmod 644 {} + 2>/dev/null || true
  find "$GRAPH_DIR" -type d -exec chmod 755 {} + 2>/dev/null || true
fi

echo "✅ Hecho. Verificación:"
echo "   archivos de otro usuario: $(find "$TARGET" -xdev -not -user "$USER_NAME" 2>/dev/null | wc -l)"
echo "   archivos no legibles:     $(find "$TARGET" -xdev ! -readable 2>/dev/null | wc -l)"
