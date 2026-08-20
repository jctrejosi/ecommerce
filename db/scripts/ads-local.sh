#!/usr/bin/env bash
# ============================================================
# ads-local.sh — corre localmente la base ADS que vive en db/ADDT
# ============================================================
# db/ADDT es la base "Publidata" del sistema POS legacy en formato
# Advantage Database Server (ADS): diccionario PUBLIDATA.add + tablas
# .adt/.adi/.adm (CATALOGO2, POSCLI, VENTAS, ...).
#
# Ese formato es propietario de SAP/Sybase (producto descontinuado): NO se
# puede leer sin el motor ADS. El driver ODBC de Advantage solo existe para
# Windows, así que en Linux lo único que puede servir estos archivos es el
# servidor "Advantage Database Server for Linux" (instalado aparte).
#
# Uso:
#   db/scripts/ads-local.sh            → detecta ADS y muestra cómo servirlo
#   db/scripts/ads-local.sh --ping     → diagnostica la conexión al servidor remoto
#   db/scripts/ads-local.sh --info     → info de los archivos de db/ADDT
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ADDT_DIR="$PROJECT_ROOT/db/ADDT"
ADD_FILE="$ADDT_DIR/PUBLIDATA.add"

# Configuración del servidor remoto (default = la del test_db/README.md)
ADS_SERVER="${ADS_SERVER:-89.117.149.145}"
ADS_PORT="${ADS_PORT:-2000}"

# ── Detección del motor ADS local ────────────────────────────

find_ads_bin() {
  local bin=""
  bin="$(command -v ads 2>/dev/null || true)"
  if [ -z "$bin" ]; then bin="$(command -v adsconf 2>/dev/null || true)"; fi
  for p in /usr/local/ads/bin/ads /opt/ads/bin/ads /usr/sbin/ads /usr/lib/ads/bin/ads; do
    if [ -z "$bin" ] && [ -x "$p" ]; then bin="$p"; fi
  done
  printf '%s' "$bin"
}

find_adsconf_bin() {
  local bin=""
  bin="$(command -v adsconf 2>/dev/null || true)"
  for p in /usr/local/ads/bin/adsconf /opt/ads/bin/adsconf /usr/sbin/adsconf; do
    if [ -z "$bin" ] && [ -x "$p" ]; then bin="$p"; fi
  done
  printf '%s' "$bin"
}

# ── Comandos ─────────────────────────────────────────────────

info() {
  echo "==> Contenido de db/ADDT (base Publidata, ADS):"
  ls -la "$ADDT_DIR"/*.add "$ADDT_DIR"/*.ai 2>/dev/null | sed 's/^/    /'
  echo
  echo "==> Tablas (.adt):"
  ls -1 "$ADDT_DIR"/*.adt "$ADDT_DIR"/*.ADT 2>/dev/null | while read -r f; do
    printf "    %-24s %s\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)"
  done
}

ping_remote() {
  echo "==> Probando TCP a $ADS_SERVER:$ADS_PORT (servidor ADS remoto)..."
  if timeout 5 bash -c "echo > /dev/tcp/$ADS_SERVER/$ADS_PORT" 2>/dev/null; then
    echo "    ✅ El puerto responde. (El handshake ACE32 puede fallar igual por cifrado;"
    echo "       ver test_db/README.md para el detalle.)"
  else
    echo "    ❌ No se pudo conectar a $ADS_SERVER:$ADS_PORT (red/firewall caído)."
  fi
}

run_local() {
  local ADS_BIN ADS_CNF
  ADS_BIN="$(find_ads_bin)"
  ADS_CNF="$(find_adsconf_bin)"

  echo "==> Base local: $ADDT_DIR"
  [ -f "$ADD_FILE" ] && echo "    Diccionario: $ADD_FILE"
  echo

  if [ -z "$ADS_BIN" ]; then
    echo "❌ No se encontró el servidor Advantage Database Server (ADS) en este equipo."
    echo
    echo "   El formato .adt/.add es propietario y descontinuado (SAP/Sybase): sin el"
    echo "   motor ADS no hay forma de abrir db/ADDT en Linux."
    echo
    echo "Opciones para correr la base ADDT localmente:"
    echo
    echo "  1) INSTALAR 'Advantage Database Server' para Linux (.deb para Debian/Ubuntu)."
    echo "     Es el único motor que sirve estos archivos en Linux. Consíguelo en la"
    echo "     máquina Windows con VISADS_25 (el instalador suele venir con el producto)"
    echo "     o en archivos históricos de Internet Archive, y vuelve a ejecutar:"
    echo "         sudo dpkg -i <archivo>.deb"
    echo "         db/scripts/ads-local.sh"
    echo
    echo "  2) EXPORTAR desde la máquina Windows (donde ADS ya funciona):"
    echo "     allí ejecuta (adscli funciona con localhost:2000):"
    echo '         adscli -q "SELECT * FROM CATALOGO2" -s localhost:2000 -d "C:\VISADS_25\ADD\Publidata.add" -o catalogo.csv'
    echo "     y luego importa el CSV al Postgres local (ecommerce)."
    echo
    echo "  3) CONECTAR al servidor remoto $ADS_SERVER:$ADS_PORT (hoy el handshake"
    echo "     falla por cifrado/firewall — detalle en test_db/README.md)."
    exit 1
  fi

  echo "✅ Motor ADS encontrado: $ADS_BIN"
  if [ -n "$ADS_CNF" ]; then echo "   Configuración (adsconf): $ADS_CNF"; fi
  echo
  echo "Para servir db/ADDT con este motor:"
  echo
  if [ -n "$ADS_CNF" ]; then
    echo "  1) Configura el DataDirectory en:  $ADS_CNF"
    echo "       DataDirectory = $ADDT_DIR"
    echo "  2) Arranca el servidor:  $ADS_BIN  (o el servicio del sistema, ej. systemctl start ads)"
  else
    echo "  1) Configura el DataDirectory de ADS para que apunte a:"
    echo "       $ADDT_DIR"
    echo "     (busca el archivo ads.ini del servidor o usa el panel de configuración)."
    echo "  2) Arranca el servidor:  $ADS_BIN"
  fi
  echo
  echo "  3) Conexión (string ODBC / datos para conectarse):"
  echo "       Server      = localhost:2000"
  echo "       DataDirectory= $ADD_FILE"
  echo "       UID/PWD     = AdsSys / Pubdata   (credenciales del diccionario)"
  echo
  echo "  NOTA: para CONSULTAR desde este Linux necesitas un cliente ADS (el driver ODBC"
  echo "  es solo Windows). Si solo necesitas los DATOS, la vía práctica es exportar a"
  echo "  CSV/Postgres desde la máquina Windows (opción 2 de arriba)."
}

# ── Main ─────────────────────────────────────────────────────

case "${1:-}" in
  --info) info ;;
  --ping) ping_remote ;;
  --help|-h)
    grep -E '^# (ads-local|#.*Uso)' "$0" >/dev/null 2>&1 || true
    sed -n '1,20p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
    ;;
  *) run_local ;;
esac
