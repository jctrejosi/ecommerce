# Respaldo de la base de datos (`ecommerce`)

Volcado de la BD local `ecommerce` (PostgreSQL 16 + PostGIS) en formato *custom*
de `pg_dump`, troceado para poder versionarlo en git/GitHub.

## Contenido

- `ecommerce.dump.part-000 … -00N` — el volcado dividido en partes (2 MB c/u).
- `ecommerce.dump.sha256` — `sha256` del volcado **completo** (reensamblado),
  para verificar integridad tras la descarga.

## Cómo lo usa `dev.js`

Al ejecutar `node dev.js`, si el contenedor `ecommerce_postgres` está arriba pero
la BD **no tiene** la tabla `products` (clon nuevo, recién inicializado por
`db/docker/init.sql`), se reensamblan las partes, se valida el `sha256` y se
restauran con `pg_restore`. Si la BD ya tiene datos, **no se toca nada**.

## Restaurar en otro PC

Lo más simple: copia el repo con `db/backup/` **completo** y ejecuta:

- **Linux / macOS / Git Bash:** `bash db/backup/restore.sh`
- **Windows (PowerShell):** `powershell -ExecutionPolicy Bypass -File .\db\backup\restore.ps1`

Ambos reensamblan las partes, **verifican el `sha256`** y al terminar imprimen los
conteos (`branches`, `products`, `prices`, `inventory`, `orders`) para confirmar
que la restauración quedó completa. Si el `sha256` no coincide (p. ej. faltó una
parte) **abortan sin tocar la BD**.

También sirve `node dev.js`: al detectar la BD vacía reensambla, valida el `sha256`,
restaura y verifica (Linux/macOS/Windows con Docker Desktop).

> Importante: para que la restauración sea completa hacen falta **todas** las
> partes (`ecommerce.dump.part-*`). Si se restaura un archivo incompleto (una sola
> parte, orden incorrecto, descarga a medias) `pg_restore` crea el esquema pero
> carga datos parciales — justo el síntoma de "solo aparece una sucursal". El
> `sha256` está para detectar exactamente eso.

### Manual (referencia)

Linux / macOS / Git Bash:

```sh
cat db/backup/ecommerce.dump.part-* > /tmp/ecommerce_restore.dump
# comprobar sha256 (opcional pero recomendado):
sha256sum /tmp/ecommerce_restore.dump | cut -d' ' -f1   # debe igualar ecommerce.dump.sha256
docker cp /tmp/ecommerce_restore.dump ecommerce_postgres:/tmp/ecommerce_restore.dump
docker exec ecommerce_postgres pg_restore -U postgres -d ecommerce --clean --if-exists --no-owner --no-privileges /tmp/ecommerce_restore.dump
```

Windows (PowerShell):

```powershell
$out = [System.IO.File]::Create("$PWD\ecommerce_restore.dump")
Get-ChildItem db\backup\ecommerce.dump.part-* | Sort-Object Name | ForEach-Object { $b=[IO.File]::ReadAllBytes($_.FullName); $out.Write($b,0,$b.Length) }
$out.Close()
docker cp ecommerce_restore.dump ecommerce_postgres:/tmp/ecommerce_restore.dump
docker exec ecommerce_postgres pg_restore -U postgres -d ecommerce --clean --if-exists --no-owner --no-privileges /tmp/ecommerce_restore.dump
```

## Regenerar el respaldo

```sh
# 1. volcado (comprimido)
docker exec ecommerce_postgres pg_dump -U postgres -d ecommerce \
  -Fc -Z 9 --no-owner --no-privileges > db/backup/ecommerce.dump

# 2. hash del volcado completo
sha256sum db/backup/ecommerce.dump | cut -d' ' -f1 > db/backup/ecommerce.dump.sha256

# 3. trocear y borrar el volcado completo (solo se versionan las partes)
split -b 2M -d --numeric-suffixes=0 -a 3 db/backup/ecommerce.dump db/backup/ecommerce.dump.part-
rm db/backup/ecommerce.dump
```

`dev.js` también acepta el volcado completo sin trocear si existe
`db/backup/ecommerce.dump`.

## Notas

- La restauración de `dev.js` usa `docker cp` + `pg_restore` desde archivo, no
  tuberías por `stdin`: así funciona igual en Linux, macOS y Windows.
- Requiere Docker Desktop (o el daemon de Docker) corriendo.
