# Respaldo `ecommerce` — 2026-10-27

Snapshot completo de la base `ecommerce` (PostgreSQL) tras sincronizar local
**desde el servidor** (`dsi-vps`), que es la copia sincronizada con el ERP
(ADD_FORTUNER / Advantage). Es el estado que reemplaza la data demo/parcial que
había quedado en local.

`pg_dump -Fc`, troceado en partes de 2 MiB para poder subirlo a GitHub.

## Contenido

- Productos: 21 613 (11 568 activos) · variantes: 21 613
- Clientes: 146 364 · pedidos: 100 (96 demo)
- Categorías: 240 (231 activas) · marcas: 3 600 · media: 15 708
- Tablas `erp_*` (invoices, payments, snapshot, outbox, code_map, …) sincronizadas
  con el ERP; tabla `shelf_rows` (estanterías).

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
  bash db/backups/ecommerce/backup_2026-10-27/restore.sh

  # Windows (PowerShell)
  powershell -ExecutionPolicy Bypass -File .\db\backups\ecommerce\backup_2026-10-27\restore.ps1
  ```

Cada `restore.*` reensambla las partes de su propio directorio, verifica el
`sha256` y ejecuta `pg_restore --clean --if-exists`.

> Hacen falta **todas** las partes (`ecommerce.dump.part-*`). Un volcado
> incompleto crea el esquema pero carga datos parciales; el `sha256` está para
> detectarlo.
