# Respaldo de la base de datos (`ecommerce`)

Volcado de la BD local `ecommerce` (PostgreSQL 16 + PostGIS) en formato *custom*
de `pg_dump`, troceado para poder versionarlo en git/GitHub.

## Contenido

- `ecommerce.dump.part-000 … -00N` — volcado dividido en partes (2 MB c/u).
- `ecommerce.dump.sha256` — `sha256` del volcado **completo** (reensamblado),
  para verificar integridad tras la descarga.

## Restaurar en un clon nuevo

Lo más simple:

```sh
node dev.js --migrate
```

Levanta PostgreSQL y, si la BD está vacía, reensambla las partes, valida el
`sha256`, restaura con `pg_restore` y verifica conteos. Si la BD **ya tiene
datos** no la toca; para sobrescribirla a propósito: `node dev.js --migrate --force`.

Scripts equivalentes:

- **Linux / macOS / Git Bash:** `bash db/backups/ecommerce/restore.sh`
- **Windows (PowerShell):** `powershell -ExecutionPolicy Bypass -File .\db\backups\ecommerce\restore.ps1`

Ambos reensamblan, **verifican el `sha256`** y al terminar imprimen los conteos
(`branches`, `products`, `prices`, `inventory`, `orders`). Si el hash no coincide
(p. ej. faltó una parte) **abortan sin tocar la BD**.

> Importante: para que la restauración sea completa hacen falta **todas** las
> partes (`ecommerce.dump.part-*`). Si se restaura un archivo incompleto
> `pg_restore` crea el esquema pero carga datos parciales — justo el síntoma de
> "solo aparece una sucursal". El `sha256` está para detectar exactamente eso.

### Manual (referencia)

Linux / macOS / Git Bash:

```sh
cat db/backups/ecommerce/ecommerce.dump.part-* > /tmp/ecommerce_restore.dump
sha256sum /tmp/ecommerce_restore.dump | cut -d' ' -f1   # debe igualar ecommerce.dump.sha256
docker cp /tmp/ecommerce_restore.dump ecommerce_postgres:/tmp/ecommerce_restore.dump
docker exec ecommerce_postgres pg_restore -U postgres -d ecommerce --clean --if-exists --no-owner --no-privileges /tmp/ecommerce_restore.dump
```

Windows (PowerShell):

```powershell
$out = [System.IO.File]::Create("$PWD\ecommerce_restore.dump")
Get-ChildItem db\backups\ecommerce\ecommerce.dump.part-* | Sort-Object Name | ForEach-Object { $b=[IO.File]::ReadAllBytes($_.FullName); $out.Write($b,0,$b.Length) }
$out.Close()
docker cp ecommerce_restore.dump ecommerce_postgres:/tmp/ecommerce_restore.dump
docker exec ecommerce_postgres pg_restore -U postgres -d ecommerce --clean --if-exists --no-owner --no-privileges /tmp/ecommerce_restore.dump
```

## Regenerar el respaldo

```sh
# 1. volcado (comprimido)
docker exec ecommerce_postgres pg_dump -U postgres -d ecommerce \
  -Fc -Z 9 --no-owner --no-privileges > db/backups/ecommerce/ecommerce.dump

# 2. hash del volcado completo
sha256sum db/backups/ecommerce/ecommerce.dump | cut -d' ' -f1 > db/backups/ecommerce/ecommerce.dump.sha256

# 3. trocear y borrar el volcado completo (solo se versionan las partes)
split -b 2M -d --numeric-suffixes=0 -a 3 db/backups/ecommerce/ecommerce.dump db/backups/ecommerce/ecommerce.dump.part-
rm db/backups/ecommerce/ecommerce.dump
```

`dev.js` también acepta el volcado completo sin trocear si existe
`db/backups/ecommerce/ecommerce.dump`.

## Imágenes (no van en el dump)

El volcado **no incluye archivos**: las fotos viven en disco y git las ignora
(`db/.gitignore`).

- `db/images_products/` — fotos del catálogo; se descomprimen de `db/JPG2.zip`
  y se enlazan a los productos con:
  `node scripts-agent/import-tid-images.mjs` (cruce por código de barras/PLU).
- `db/images_static/` — espejo local de Cloudinary (marcas, categorías, banners,
  avatares…), pruebas de entrega y subidas nuevas. Se regenera con:
  `node scripts-agent/migrate-cloudinary-to-local.mjs` (requiere las credenciales
  `CLOUDINARY_*` de `backend/.env.development.local`).

El backend sirve esas carpetas en `/static/products/*` y `/static/media/*`, y en
la BD las rutas quedan como `/static/...` (relativas al backend). Así funciona
igual en local, LAN y móvil sin depender de Cloudinary. En desarrollo las
subidas nuevas se guardan en disco; en producción el modo por defecto sigue
siendo Cloudinary (`MEDIA_STORAGE=local|cloudinary` lo fuerza).

## Notas

- `dev.js` restaura automáticamente al arrancar si detecta un clon nuevo
  (BD sin tabla `products`); `--migrate` lo hace explícito y `--migrate --force`
  permite sobrescribir una BD con datos.
- La restauración de `dev.js` usa `docker cp` + `pg_restore` desde archivo, no
  tuberías por `stdin`: así funciona igual en Linux, macOS y Windows.
- Requiere Docker Desktop (o el daemon de Docker) corriendo.
