#!/usr/bin/env bash
#
# Prepara el extracto de OSRM para Manizales (Caldas, Colombia).
#
#  1. Descarga colombia-latest.osm.pbf de Geofabrik (313 MB, cacheado).
#  2. Recorta al bbox de Manizales + ~5 km de padding con osmium.
#  3. Preprocesa con OSRM: extract → partition → customize (perfil car).
#
# Requisitos: osmium (osmcode/osmium-tool) y Docker.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="$DIR/data"
mkdir -p "$DATA"

GEOFABRIK_URL="https://download.geofabrik.de/south-america/colombia-latest.osm.pbf"
COLOMBIA="$DATA/colombia-latest.osm.pbf"
MANIZALES="$DATA/manizales.osm.pbf"
OSRM_IMAGE="osrm/osrm-backend:latest"

# Perímetro urbano Manizales (OSM relation 406051) + padding ≈ 5 km.
LEFT="-75.60"
BOTTOM="4.97"
RIGHT="-75.37"
TOP="5.16"

if [ ! -f "$COLOMBIA" ]; then
  echo "⬇️  Descargando Colombia (313 MB) — solo la primera vez…"
  curl -fL --retry 3 --retry-delay 5 -o "$COLOMBIA" "$GEOFABRIK_URL"
else
  echo "✅ Usando extracto de Colombia ya descargado ($COLOMBIA)"
fi

echo "✂️  Recortando a Manizales (bbox $LEFT,$BOTTOM,$RIGHT,$TOP)…"
osmium extract \
  -b "$LEFT,$BOTTOM,$RIGHT,$TOP" \
  --strategy complete_ways \
  --overwrite \
  -o "$MANIZALES" \
  "$COLOMBIA"

echo "⚙️  osrm-extract (perfil car)…"
docker run --rm -v "$DATA:/data" "$OSRM_IMAGE" osrm-extract -p /opt/car.lua /data/manizales.osm.pbf

echo "⚙️  osrm-partition…"
docker run --rm -v "$DATA:/data" "$OSRM_IMAGE" osrm-partition /data/manizales.osrm

echo "⚙️  osrm-customize…"
docker run --rm -v "$DATA:/data" "$OSRM_IMAGE" osrm-customize /data/manizales.osrm

echo ""
echo "✅ Listo. Arranca el router con:  docker compose -f \"$DIR/docker-compose.yml\" up -d"
echo "   Prueba:  curl 'http://localhost:5000/route/v1/car/-75.50,5.06;-75.48,5.07?overview=false'"
