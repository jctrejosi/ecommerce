/**
 * Verifica que db/backup esté completo: restaura en `verify_test` y compara el
 * número de filas de TODAS las tablas (todos los esquemas de usuario) contra la
 * BD viva. Uso: NODE_PATH=backend/node_modules node scripts-agent/verify-backup.cjs
 */
const { Client } = require("pg");

const BASE = "postgresql://postgres:postgres@localhost:5432/";

const TABLES_SQL = `
  SELECT table_schema, table_name
    FROM information_schema.tables
   WHERE table_type='BASE TABLE'
     AND table_schema NOT LIKE 'pg\\_%'
     AND table_schema <> 'information_schema'
   ORDER BY table_schema, table_name`;

(async () => {
  const live = new Client({ connectionString: BASE + "ecommerce" });
  const test = new Client({ connectionString: BASE + "verify_test" });
  await live.connect();
  await test.connect();

  const { rows: tabs } = await live.query(TABLES_SQL);
  const testSet = new Set(
    (await test.query(TABLES_SQL)).rows.map((r) => `${r.table_schema}.${r.table_name}`),
  );

  const missing = [];
  const mismatches = [];
  let compared = 0;
  for (const t of tabs) {
    const full = `"${t.table_schema}"."${t.table_name}"`;
    if (!testSet.has(`${t.table_schema}.${t.table_name}`)) {
      missing.push(full);
      continue;
    }
    const a = (await live.query(`SELECT count(*)::int n FROM ${full}`)).rows[0].n;
    const b = (await test.query(`SELECT count(*)::int n FROM ${full}`)).rows[0].n;
    compared++;
    if (a !== b) mismatches.push(`${full}: live=${a} backup=${b}`);
  }

  const schemas = [...new Set(tabs.map((t) => t.table_schema))];
  console.log(`esquemas: ${schemas.join(", ")}`);
  console.log(`tablas en la BD viva: ${tabs.length}  (comparadas: ${compared})`);
  console.log(`faltantes en el backup: ${missing.length}`);
  missing.slice(0, 30).forEach((m) => console.log("   FALTA " + m));
  console.log(`con distinto numero de filas: ${mismatches.length}`);
  mismatches.slice(0, 30).forEach((m) => console.log("   DIFF  " + m));

  await live.end();
  await test.end();
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
