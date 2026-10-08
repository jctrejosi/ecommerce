#!/usr/bin/env bash
# Compila OpenADS dentro de un contenedor Debian (el host no tiene cmake).
# Salida en db/ads/openads/build (no se versiona).
#
# Uso: bash db/ads/openads/build.sh
set -euo pipefail

BASE=/home/jk/Proyectos/dsi/ecommerce/db/ads/openads
mkdir -p "$BASE/build"

docker run --rm \
  -v "$BASE/src:/src" \
  -v "$BASE/build:/build" \
  -w /build \
  debian:bookworm-slim bash -c '
set -e
apt-get update -qq
apt-get install -y -qq --no-install-recommends cmake g++ make ca-certificates
echo "=== configure ==="
cmake -DCMAKE_BUILD_TYPE=Release \
      -DOPENADS_WARNINGS_AS_ERRORS=OFF \
      -DOPENADS_BUILD_TESTS=OFF \
      -DOPENADS_WITH_TLS=OFF \
      -DOPENADS_WITH_SQLITE=OFF \
      -DOPENADS_WITH_HTTP=ON \
      /src
echo "=== build ==="
make -j8
echo "=== artefactos ==="
find /build -maxdepth 4 -type f \( -name "openads_serverd" -o -name "libace*.so*" -o -name "openads_*" -o -name "adi_inspect" \) -print 2>/dev/null
'
