# Backup ecommerce — producción (2026-11-10)

Volcado **completo** (esquema + datos) de la base `ecommerce` del servidor de
producción `srv-prod` (host SSH `jcti`, 169.58.255.64), tomado el
**2026-11-10** desde el contenedor `ecommerce_db` (`postgis/postgis:16-3.4`).

## Contenido

- `ecommerce.dump` — dump en formato custom de PostgreSQL (19 MB).
- `ecommerce.dump.sha256` — SHA-256 del dump
  (`39e0f9c0…b1fb92da`), verificado al restaurar.
- `restore.sh` — restaura el backup en una base local.

| Dato | Valor |
|---|---|
| Tamaño del dump | 19 MB |
| Tamaño de la BD | 194 MB |
| Productos | 21 613 |
| Imágenes de producto | 18 671 |
| Atributos de producto | 182 291 |
| Clientes | 146 324 |
| Pedidos | 4 |
| Usuarios admin | 6 |
| Registros en `media` | 18 806 |
| Extensiones | postgis, postgis_topology, postgis_tiger_geocoder, pg_trgm, citext, unaccent, uuid-ossp, fuzzystrmatch |

Generado con:

```bash
ssh jcti 'docker exec ecommerce_db pg_dump -U postgres -d ecommerce -Fc --no-owner --no-acl' \
  > ecommerce.dump
sha256sum ecommerce.dump > ecommerce.dump.sha256
```

## Las imágenes NO están en el dump

La BD solo guarda rutas relativas (`media.path = /static/...`). Los binarios
viven en el volumen `mercaldas_media` del servidor, montado en `/app/db`, y en
este repo se reflejan en `db/images_static/` (gitignored).

Estado sincronizado el **2026-11-10**:

| | Servidor | Local |
|---|---|---|
| Archivos | 18 747 | 23 761 (incluye archivos local-only) |
| Tamaño | 4,5 GB | 6,3 GB |

Comando usado para traerlas (idempotente, se puede repetir; **no** usa
`--delete`, así que conserva archivos locales que no estén en el servidor):

```bash
rsync -rt --size-only --partial --no-owner --no-group \
  --rsync-path="sudo rsync" -e "ssh -o BatchMode=yes" \
  jcti:/var/lib/docker/volumes/mercaldas_media/_data/images_static/ \
  db/images_static/
```

Verificación de contenido (no solo tamaño/fecha):

```bash
rsync -rt --checksum --dry-run --rsync-path="sudo rsync" \
  -e "ssh -o BatchMode=yes" \
  jcti:/var/lib/docker/volumes/mercaldas_media/_data/images_static/ \
  db/images_static/
# debe reportar: "Number of regular files transferred: 0"
```

Layout y convenciones de las rutas: ver `docs/DATABASE.md` § *Almacenamiento
de estáticos (imágenes)*.

## Restaurar

```bash
bash db/backups/ecommerce/backup_2026-11-10-prod/restore.sh [nombre_bd]
```

Por defecto restaura sobre la BD `ecommerce` del contenedor
`ecommerce_postgres`, **recreándola** (`drop database … with (force)`, así que
cierra las conexiones abiertas y borra la base existente). El script verifica
el SHA-256 antes de restaurar y muestra los conteos al final.

## Usar las imágenes en local

- **Backend en dev** (`yarn start:dev` con `cwd=backend/`): `MEDIA_STATIC_DIR`
  por defecto resuelve a `<repo>/db`, así que sirve `db/images_static/` sin
  pasos extra (`backend/src/utils/media-static.ts`).
- **Stack Docker**: el backend monta el volumen `mercaldas_media` en `/app/db`
  y espera `images_static/` dentro. El volumen no se rellena solo desde el
  repo: hay que poblarlo, o montar `./db:/app/db` en desarrollo.

## Notas

- El dump incluye `CREATE EXTENSION postgis*`, así que el destino debe ser una
  imagen con PostGIS (la del compose ya lo es).
- Se restauró y verificó en local: 21 613 productos, 18 671 imágenes,
  146 324 clientes, 0 huérfanos en `product_images`, y 400/400 rutas de `media`
  existentes en `db/images_static`.
- Antes de sobrescribir la BD local se guardó un respaldo de seguridad en
  `db/backups/_pre-restore-local-2026-11-10.dump` (ignorado por git).
