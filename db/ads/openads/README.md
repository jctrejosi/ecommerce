# OpenADS — servidor Advantage (ADS) en Docker

Monta las tablas Advantage del ERP (`.adt` / `.adm` / `.adi`) con
[OpenADS](https://github.com/FiveTechSoft/OpenADS), la reimplementación
open-source del *Advantage Client Engine* de SAP.

> Contexto y resultados de la prueba: `docs/OPENADS-VALIDACION.md`.

## Por qué

El instalador de SAP para Linux está descontinuado y **no es público**, por lo
que el plan original de `db/ads/` (servidor ADS oficial) estaba bloqueado.
OpenADS lee/escribe los `.adt` nativos de forma byte-compatible y corre en Linux.

## Estructura

```
db/ads/openads/
├── src/            # clon de OpenADS (gitignored)
├── build/          # artefactos compilados en contenedor (gitignored)
├── data/           # copia ESCRIBIBLE de las tablas a servir (gitignored)
├── data-test/      # copia de prueba usada en la validación (gitignored)
├── Dockerfile      # build multi-etapa -> imagen final
├── docker-compose.yml
└── build.sh        # compila en contenedor (el host puede no tener cmake)
```

## Uso

```bash
# 1. compilar el motor (en contenedor)
bash db/ads/openads/build.sh

# 2. imagen final
docker build -t mercaldas/openads:1.09.73 -f db/ads/openads/Dockerfile db/ads/openads

# 3. preparar la copia de datos (ESCRIBIBLE, nunca solo lectura)
mkdir -p db/ads/openads/data
cp -r db/ADD_ANALITICA/. db/ads/openads/data/

# 4. arrancar
cd db/ads/openads && docker compose up -d
# o sin compose:
# docker run -d --name openads -p 16262:6262 -p 18080:8080 \
#   -v "$PWD/db/ads/openads/data:/data" mercaldas/openads:1.09.73
```

| Servicio | URL / puerto |
|---|---|
| Consola web Studio (REST + SQL) | <http://localhost:18080> (`dsi` / `dsi`) |
| Protocolo wire ADS (clientes `ace*.dll`) | `localhost:16262` |

## Con `node dev.js`

El lanzador levanta este contenedor **junto a PostgreSQL** (salvo que se pase
`--no-advantage`). Hace, de forma idempotente:

- Verifica que exista la imagen `mercaldas/openads:1.09.73` (si no, avisa y da el
  comando de build; no aborta el resto del stack).
- Asegura la copia escribible en `db/ads/openads/data` (la siembra desde
  `data-test`, o desde `db/ADD_ANALITICA` si aquella no está).
- Arranca/reutiliza el contenedor `openads-img` en `:16262` y `:18080`.

Se detiene con `node dev.js --stop` o `docker stop openads-img`. La Studio está
en <http://localhost:18080> (entrar con `?_auth_user=dsi&_auth_pass=dsi` si el
navegador no muestra el diálogo de Basic auth).

```bash
curl -u dsi:dsi http://localhost:18080/api/health
curl -u dsi:dsi "http://localhost:18080/api/tables/TIDMARCAS/rows?limit=5"
curl -u dsi:dsi "http://localhost:18080/api/tables/FADITE.ADT/schema"
```

## Reglas de operación

- **La carpeta de datos debe ser escribible** (el motor crea locks y journal).
  Nunca montar el original en solo lectura.
- **No apuntar dos motores a los mismos archivos**: la copia de trabajo es
  independiente del directorio que usa el ERP en producción.
- **Nombres sensibles a mayúsculas** en Linux: `TIDCATE.ADT` ≠ `TIDCATE.adt`.
- **Sin TLS nativo**: el listener va en claro → usar LAN aislada o un proxy TLS.
- **Cambiar** `dsi:dsi` por credenciales reales en `docker-compose.yml`.

## Limitaciones conocidas

- Diccionarios SAP (`.add`) **no** utilizables: `openads_import_dd` necesita la
  librería ACE de SAP (no disponible). No afecta a las *free tables* del ERP.
- Los **triggers requieren diccionario** (nuestras tablas son *free tables*), y
  en SQL disparan **una vez por lote**, no por fila.
- La consola Studio lista solo `.dbf`; las `.adt` se abren por nombre.
