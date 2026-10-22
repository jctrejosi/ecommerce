# Respaldo `ecommerce` — 2026-10-22

Snapshot completo de la base `ecommerce` (PostgreSQL) tomado **después** de la
importación del catálogo/clientes, del trabajo de imágenes y de la integración
con el ERP. Incluye las tablas `erp_*`, los triggers de sincronización y los
atributos enriquecidos (`nombre-corto`, `nombre-largo`, `categoria-erp`, etc.).

`pg_dump -Fc`, troceado en partes de 2 MiB para poder subirlo a GitHub.

## Restaurar

- **Automático** (desde la raíz del proyecto):

  ```bash
  node dev.js --migrate
  ```

  Restaura el snapshot `backup_<fecha>` más reciente. Si la BD ya tiene datos no
  la toca; `--force` la sobrescribe.

- **Manual**:

  ```bash
  # Linux/macOS
  bash db/backups/ecommerce/backup_2026-10-22/restore.sh

  # Windows (PowerShell)
  powershell -ExecutionPolicy Bypass -File .\db\backups\ecommerce\backup_2026-10-22\restore.ps1
  ```

Cada `restore.*` reensambla las partes de su propio directorio, verifica el
`sha256` y ejecuta `pg_restore --clean --if-exists`.

> Hacen falta **todas** las partes (`ecommerce.dump.part-*`). Un volcado
> incompleto crea el esquema pero carga datos parciales; el `sha256` está para
> detectarlo.

## Después de restaurar

```bash
node scripts-agent/erp/init-db.mjs   # idempotente: asegura tablas/triggers erp_*
node scripts-agent/erp/sync-codes.mjs
node scripts-agent/erp/health.mjs
```

Las imágenes estáticas **no** viven en la base: están en `db/images_static/`
(fuera de git por tamaño). Cópialas al servidor conservando esa ruta, o vuelve a
extraer `db/JPG2.zip`.
