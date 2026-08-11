#!/usr/bin/env node
/**
 * Migración Local → Supabase (producción) sin Docker.
 *
 * Copia tabla por tabla los datos de la BD local a Supabase usando node-postgres.
 *
 * Uso:
 *   PROD_DATABASE_URL='postgresql://user:pass@host:port/db' \
 *   node migrate-local-to-supabase.mjs --yes
 *
 * Variables de entorno:
 *   LOCAL_DATABASE_URL  (default: postgresql://postgres:postgres@localhost:5432/ecommerce)
 *   PROD_DATABASE_URL   (obligatoria)
 *   PROD_DB_SSL=1       fuerza SSL { rejectUnauthorized:false } hacia producción
 *   BACKUP_BEFORE=0     omite el backup de seguridad de producción
 */
import { createRequire } from "node:module";
import { writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Client } = require(
  "/home/jk/Projects/dsi/mercaldas-ecommerce/backend/node_modules/pg",
);

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOCAL_URL =
  process.env.LOCAL_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/ecommerce";
const PROD_URL = process.env.PROD_DATABASE_URL || "";
const PROD_SSL = process.env.PROD_DB_SSL === "1" || true; // Supabase siempre requiere SSL
const BACKUP_BEFORE = process.env.BACKUP_BEFORE !== "0";
const CONFIRM = !process.argv.includes("--yes");

// Tablas gestionadas por extensiones (PostGIS) — no se copian
const EXCLUDED_TABLES = new Set([
  "spatial_ref_sys",
  "geography_columns",
  "geometry_columns",
  "raster_columns",
  "raster_overviews",
  "topology",
  "layer",
  "topology_layer",
]);

const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const BATCH = 200;

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function connect(url, ssl) {
  const c = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await c.connect();
  return c;
}

async function confirm() {
  if (!CONFIRM) return;
  const rl = require("node:readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise((res) =>
    rl.question("\n⚠ Esto REEMPLAZARÁ los datos de Supabase con los de local. ¿Continuar? (s/N) ", res),
  );
  rl.close();
  if (answer.trim().toLowerCase() !== "s") {
    console.log("\nCancelado. No se modificó Supabase.");
    process.exit(0);
  }
}

async function listTables(client) {
  const r = await client.query(
    `SELECT c.relname AS name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname`,
  );
  return r.rows.map((x) => x.name).filter((t) => !EXCLUDED_TABLES.has(t));
}

async function getColumns(client, table) {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((x) => x.column_name);
}

async function getSerialColumns(client) {
  const r = await client.query(
    `SELECT c.relname AS table_name, a.attname AS column_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND a.attnum > 0 AND NOT a.attisdropped
       AND (a.attidentity <> '' OR pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%')`,
  );
  return r.rows;
}

async function backupTarget(client, tables) {
  const out = {};
  for (const t of tables) {
    const cols = await getColumns(client, t);
    const rows = await client.query(`SELECT * FROM "${t}"`);
    out[t] = { columns: cols, rows: rows.rows };
  }
  const file = join(__dirname, `supabase_before_${TS}.json`);
  writeFileSync(file, JSON.stringify(out));
  console.log(`✓ Backup de Supabase: ${file} (${(statSync(file).size / 1024).toFixed(0)} KB)`);
}

async function truncateTable(dst, table) {
  await dst.query(`TRUNCATE TABLE "${table}" CASCADE`);
}

async function copyTable(src, dst, table, log) {
  const cols = await getColumns(src, table);
  if (!cols.length) {
    log.push(`  ${table}: sin columnas, omitida`);
    return 0;
  }
  const colSql = cols.map((c) => `"${c}"`).join(", ");

  const sel = await src.query(`SELECT ${colSql} FROM "${table}"`);
  const rows = sel.rows;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = [];
    const params = [];
    let p = 0;
    for (const row of chunk) {
      // Numeración de placeholders CONTÍNUA por batch:
      // ($1..$22), ($23..$44), ... (cada fila usa índices nuevos)
      const ph = cols.map(() => `$${++p}`).join(", ");
      const vals = cols.map((c) => {
        let v = row[c];
        if (v === undefined) return null;
        if (typeof v === "object" && v !== null && !(v instanceof Date) && !Buffer.isBuffer(v)) {
          return JSON.stringify(v); // json/jsonb
        }
        return v;
      });
      values.push(`(${ph})`);
      params.push(...vals);
    }
    await dst.query(
      `INSERT INTO "${table}" (${colSql}) VALUES ${values.join(", ")}`,
      params,
    );
    inserted += chunk.length;
  }

  // Verificar que la escritura persista en el mismo cliente
  const cnt = await dst.query(`SELECT count(*)::int AS n FROM "${table}"`);
  const okCnt = cnt.rows[0].n === inserted;
  log.push(`  ${table}: ${inserted} filas ${okCnt ? "✓" : "✗ (en destino: " + cnt.rows[0].n + ")"}`);
  return inserted;
}

async function resetSequences(client, tables) {
  const serials = (await getSerialColumns(client)).filter((s) =>
    tables.includes(s.table_name),
  );
  const esc = (x) => String(x).replace(/'/g, "''");
  for (const s of serials) {
    const seq = `pg_get_serial_sequence('public.${esc(s.table_name)}', '${esc(s.column_name)}')`;
    await client.query(
      `SELECT setval(${seq}, COALESCE((SELECT MAX("${s.column_name}") FROM "public"."${s.table_name}"), 1), EXISTS (SELECT 1 FROM "public"."${s.table_name}"))`,
    );
  }
  if (serials.length) console.log(`✓ Secuencias reiniciadas (${serials.length} columnas)`);
}

async function main() {
  console.log("━━━ Migración Local → Supabase (tabla por tabla) ━━━");
  if (!PROD_URL) fail("Define PROD_DATABASE_URL");

  const src = await connect(LOCAL_URL, false);
  const dst = await connect(PROD_URL, PROD_SSL ? { rejectUnauthorized: false } : false);
  console.log(`Local     : ${src.connectionParameters.host}:${src.connectionParameters.port}/${src.connectionParameters.database}`);
  console.log(`Supabase  : ${dst.connectionParameters.host}:${dst.connectionParameters.port}/${dst.connectionParameters.database}`);

  const tables = await listTables(src);
  const dstTables = new Set(await listTables(dst));
  const missing = tables.filter((t) => !dstTables.has(t));
  if (missing.length) console.log(`⚠ Tablas locales que no existen en Supabase (se omiten): ${missing.join(", ")}`);
  const toCopy = tables.filter((t) => dstTables.has(t));
  console.log(`Tablas a copiar: ${toCopy.length}\n`);

  if (BACKUP_BEFORE) {
    console.log("[backup] Guardando estado actual de Supabase...");
    await backupTarget(dst, toCopy);
  }

  await confirm();

  // Desactivar FKs durante la copia (evita problemas de orden)
  let fkDisabled = true;
  try {
    await dst.query("SET session_replication_role = replica");
  } catch (e) {
    fkDisabled = false;
    console.warn("⚠ No se pudo desactivar FKs (session_replication_role):", e.message);
  }

  // FASE A: truncar TODAS las tablas primero (CASCADE puede borrar tablas
  // ya insertadas si se intercalara; con truncado previo global no hay problema)
  console.log("[truncate] Vaciando destino...");
  for (const t of toCopy) {
    await truncateTable(dst, t);
  }
  console.log(`✓ ${toCopy.length} tablas truncadas`);

  // FASE B: insertar todos los datos (FKs desactivadas)
  const log = [];
  console.log("[copy] Copiando datos...");
  for (const t of toCopy) {
    try {
      await copyTable(src, dst, t, log);
    } catch (e) {
      console.error(`✗ Error en ${t}: ${e.message}`);
      if (fkDisabled) await dst.query("SET session_replication_role = origin").catch(() => {});
      fail(`Migración abortada en ${t}. Revisa el error arriba.`);
    }
  }

  if (fkDisabled) {
    await dst.query("SET session_replication_role = origin");
    console.log("✓ FKs reactivadas");
  }

  console.log("[seq] Reiniciando secuencias...");
  await resetSequences(dst, toCopy);

  console.log("\n[verify] Conteos Local vs Supabase (todas las tablas):");
  let ok = true;
  for (const t of toCopy) {
    const a = (await src.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
    const b = (await dst.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
    const match = a === b;
    if (!match) ok = false;
    if (!match || a > 0) {
      console.log(`  ${t.padEnd(26)} local ${String(a).padStart(7)}  supabase ${String(b).padStart(7)}  ${match ? "✓" : "✗ DIFERENCIA"}`);
    }
  }
  console.log("\n" + log.join("\n"));
  console.log(ok ? "\n✅ Supabase idéntica a local." : "\n⚠ Hay diferencias, revisa las tablas marcadas.");

  await src.end();
  await dst.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
