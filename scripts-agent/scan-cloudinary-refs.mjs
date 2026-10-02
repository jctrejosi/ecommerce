#!/usr/bin/env node
/**
 * Escanea TODAS las columnas de texto/json de la BD buscando referencias a
 * `res.cloudinary.com` (URLs que quedaron sin migrar a disco).
 * No modifica nada. Salida: sólo tablas.columnas con coincidencias.
 *
 * Uso: node scripts-agent/scan-cloudinary-refs.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const dotenv = require('dotenv');
const { Client } = require('pg');

const backendDir = fileURLToPath(new URL('../backend/', import.meta.url));
dotenv.config({ path: path.join(backendDir, '.env.development.local') });

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const cols = (
  await client.query(`
    SELECT table_schema, table_name, column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type IN ('text', 'character varying', 'character', 'jsonb', 'json')
     ORDER BY table_name, column_name
  `)
).rows;

let hits = 0;
for (const c of cols) {
  const count = (
    await client.query(
      `SELECT count(*)::int AS n FROM "${c.table_schema}"."${c.table_name}"
        WHERE "${c.column_name}"::text LIKE '%res.cloudinary.com%'`,
    )
  ).rows[0].n;
  if (count > 0) {
    hits++;
    console.log(`${c.table_name}.${c.column_name} (${c.data_type}): ${count}`);
  }
}

console.log(`\nColumnas escaneadas: ${cols.length}. Con referencias: ${hits}`);

await client.end();
