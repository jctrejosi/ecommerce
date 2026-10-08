# Respaldo `ecommerce` — 2026-10-08

Snapshot de la base `ecommerce` (PostgreSQL) tomado **antes** de seguir con las
escrituras de integración con el ERP (Fase 4) y el resto del trabajo sobre el
catálogo. `pg_dump -Fc`, troceado en partes de 2 MiB.

- **sha256 del volcado completo:** `8c755b99b64bb38631f11acbd10fcb35ee62f63f6cc3f8d67ea8d78ec6931dfa`
- **Restaurar:** `bash restore.sh` (o `restore.ps1` en Windows) desde este
  directorio. `node dev.js --migrate` usa este snapshot por ser el más reciente.
