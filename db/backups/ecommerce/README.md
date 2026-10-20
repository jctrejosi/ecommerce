# Respaldos de la base `ecommerce`

Cada **subdirectorio `backup_<fecha>`** es un volcado completo y autocontenido de
la base Postgres `ecommerce` (`pg_dump -Fc`), troceado en partes de 2 MiB para
poder subirlo a GitHub.

```
db/backups/ecommerce/
├── backup_2026-10-05/   ← snapshot anterior
│   ├── ecommerce.dump.part-000 … -00N
│   ├── ecommerce.dump.sha256
│   └── restore.sh / restore.ps1 / README.md
└── backup_2026-10-08/   ← snapshot más reciente
    └── (misma estructura)
```

## Restaurar

- **`node dev.js --migrate`** restaura **el snapshot más reciente** (el
  `backup_<fecha>` con la fecha mayor). Si la BD ya tiene datos no la toca;
  `--force` la sobrescribe.
- Manual (un snapshot concreto):
  - Linux/macOS: `bash db/backups/ecommerce/backup_2026-10-08/restore.sh`
  - Windows: `powershell -ExecutionPolicy Bypass -File .\db\backups\ecommerce\backup_2026-10-08\restore.ps1`

Cada `restore.*` reensambla las partes **de su propio directorio**, verifica el
`sha256` y ejecuta `pg_restore --clean --if-exists`.

> Para que la restauración sea completa hacen falta **todas** las partes
> (`ecommerce.dump.part-*`): un volcado incompleto crea el esquema pero carga
> datos parciales. El `sha256` está para detectar exactamente eso.

## Regenerar / crear un nuevo snapshot

```bash
DIR=db/backups/ecommerce/backup_$(date +%F)
mkdir -p "$DIR"

# 1. volcado (dentro del contenedor) y copia al host
docker exec ecommerce_postgres pg_dump -U postgres -d ecommerce -Fc -f /tmp/ecommerce.dump
docker cp ecommerce_postgres:/tmp/ecommerce.dump "$DIR/ecommerce.dump"
docker exec ecommerce_postgres rm -f /tmp/ecommerce.dump

# 2. hash del volcado completo
sha256sum "$DIR/ecommerce.dump" | cut -d' ' -f1 > "$DIR/ecommerce.dump.sha256"

# 3. trocear y borrar el volcado completo
split -b 2097152 -d -a 3 "$DIR/ecommerce.dump" "$DIR/ecommerce.dump.part-"
rm "$DIR/ecommerce.dump"

# 4. scripts de restauración
cp db/backups/ecommerce/backup_2026-10-08/restore.sh \
   db/backups/ecommerce/backup_2026-10-08/restore.ps1 "$DIR/"
```

`dev.js` también acepta un volcado completo sin trocear si existe
`ecommerce.dump` en el subdirectorio.
