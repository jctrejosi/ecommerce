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
 *   TABLES='a,b,c'      copia SOLO esas tablas (útil para sincronizar solo el catálogo
 *                       sin tocar datos transaccionales de producción)
 *
 * Flags:
 *   --yes       no pedir confirmación
 *   --dry-run   NO modifica nada: solo compara conteos Local vs Supabase
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
const DRY_RUN = process.argv.includes("--dry-run");
const TABLE_FILTER = process.env.TABLES
  ? new Set(
      process.env.TABLES.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;

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
  const file = join(__dirname, '..', 'backups', 'supabase', `supabase_before_${TS}.json`);
  writeFileSync(file, JSON.stringify(out));
  console.log(`✓ Backup de Supabase: ${file} (${(statSync(file).size / 1024).toFixed(0)} KB)`);
}

async function truncateTable(dst, table) {
  if (TABLE_FILTER) {
    // Modo filtrado: NUNCA usar TRUNCATE CASCADE — vaciaría también las
    // tablas que referencian a ésta (product_variants, cart_items,
    // order_items, etc.) aunque no estén en el filtro. Con
    // session_replication_role=replica los triggers de FK no disparan,
    // así que DELETE vacía SOLO esta tabla (los IDs se conservan, las
    // referencias externas siguen apuntando a los mismos IDs).
    await dst.query(`DELETE FROM "${table}"`);
  } else {
    await dst.query(`TRUNCATE TABLE "${table}" CASCADE`);
  }
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
  let toCopy = tables.filter((t) => dstTables.has(t));
  if (TABLE_FILTER) {
    const notFound = [...TABLE_FILTER].filter((t) => !toCopy.includes(t));
    if (notFound.length) {
      console.log(`⚠ TABLES: no existen localmente o en Supabase (se omiten): ${notFound.join(", ")}`);
    }
    toCopy = toCopy.filter((t) => TABLE_FILTER.has(t));
  }
  console.log(`Tablas a copiar: ${toCopy.length}${DRY_RUN ? "  [DRY-RUN: sin cambios]" : ""}\n`);

  if (DRY_RUN) {
    console.log("[verify] Conteos Local vs Supabase (solo lectura):");
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
    console.log(ok ? "\n✅ Los conteos coinciden (nada que cambiar)." : "\n⚠ Hay diferencias. Revisa la lista y ejecuta sin --dry-run cuando estés listo.");
    await src.end();
    await dst.end();
    return;
  }

  if (BACKUP_BEFORE) {
    console.log("[backup] Guardando estado actual de Supabase...");
    await backupTarget(dst, toCopy);
  }

  await confirm();

  // Toda la fase destructiva dentro de UNA transacción: si algo falla a
  // mitad (p. ej. FKs que no se pueden desactivar), se hace ROLLBACK y
  // producción queda intacta.
  await dst.query("BEGIN");

  // Desactivar FKs durante la copia (evita problemas de orden)
  let fkDisabled = true;
  try {
    await dst.query("SET session_replication_role = replica");
  } catch (e) {
    fkDisabled = false;
    console.warn("⚠ No se pudo desactivar FKs (session_replication_role):", e.message);
  }

  try {
    // FASE A: vaciar las tablas destino (en modo filtrado: DELETE sin
    // CASCADE para no arrastrar tablas fuera del filtro; en modo completo:
    // TRUNCATE CASCADE global como siempre)
    console.log("[truncate] Vaciando destino...");
    for (const t of toCopy) {
      await truncateTable(dst, t);
    }
    console.log(`✓ ${toCopy.length} tablas vaciadas`);

    // FASE B: insertar todos los datos (FKs desactivadas)
    const log = [];
    console.log("[copy] Copiando datos...");
    for (const t of toCopy) {
      try {
        await copyTable(src, dst, t, log);
      } catch (e) {
        throw new Error(`Error en ${t}: ${e.message}`);
      }
    }

    console.log("[seq] Reiniciando secuencias...");
    await resetSequences(dst, toCopy);

    await dst.query("COMMIT");
    console.log("✓ Transacción confirmada");

    if (fkDisabled) {
      await dst.query("SET session_replication_role = origin");
      console.log("✓ FKs reactivadas");
    }

    console.log("\n" + log.join("\n"));
  } catch (e) {
    await dst.query("ROLLBACK").catch(() => {});
    console.error(`✗ ${e.message}`);
    fail(
      "Migración abortada y REVERTIDA (ROLLBACK): producción quedó como estaba. " +
        "Revisa el error arriba.",
    );
  }

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
  console.log(ok ? "\n✅ Supabase idéntica a local." : "\n⚠ Hay diferencias, revisa las tablas marcadas.");

  await src.end();
  await dst.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
