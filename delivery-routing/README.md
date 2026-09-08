# Delivery Routing (OSRM)

Motor de rutas OSRM auto-hospedado para el delivery. Calcula rutas por calles,
distancia y duración sobre datos de OpenStreetMap, sin API key ni costos.

## Alcance actual

- **Extracto**: Manizales (Caldas, Colombia), perímetro urbano + ~5 km de padding.
- **Perfil**: `car` (OSRM no trae perfil de moto; `car` es la aproximación estándar).
- **Algoritmo**: MLD (`--algorithm mld`), ligero y rápido para este tamaño.

## Uso

```bash
# 1. Preparar datos (solo la primera vez o para refrescar el mapa)
./prepare.sh

# 2. Levantar el router
docker compose up -d

# 3. Probar
curl 'http://localhost:5000/route/v1/car/-75.5166,5.0669;-75.4910,5.0682?overview=full'
```

- Puerto: **5000**
- Formato de consulta: `GET /route/v1/{profile}/{lon1,lat1};{lon2,lat2}`
- Parámetros útiles: `overview=full` (devuelve geometría), `geometries=polyline`.

## Fuente de datos

- Geofabrik Colombia (país completo, sin subregiones): `colombia-latest.osm.pbf`.
- `prepare.sh` lo recorta al bbox de Manizales con `osmium extract` y luego
  corre `osrm-extract` → `osrm-partition` → `osrm-customize`.

## Notas

- El backend consume este servicio vía HTTP; **no** es necesario que la app
  móvil lo conozca (el endpoint queda en `ecommerce/backend`).
- Para agregar otra ciudad: repetir el recorte con su bbox y un perfil distinto
  (`./data/<ciudad>.osrm`), o bien pasar a extracto nacional completo.
