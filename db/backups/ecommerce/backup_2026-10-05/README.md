# Respaldo `ecommerce` — 2026-10-05

Snapshot de la base `ecommerce` (PostgreSQL), `pg_dump -Fc`, troceado en partes
de 2 MiB.

- **sha256 del volcado completo:** `7ca30a94b761cf4634ee0c4d3f9c526b8cc1bfab88884da4c5966723f6b12a5f`
- **Restaurar:** `bash restore.sh` (o `restore.ps1` en Windows) desde este
  directorio. `node dev.js --migrate` restaura el snapshot **más reciente**
  (hoy, `backup_2026-10-08`).
