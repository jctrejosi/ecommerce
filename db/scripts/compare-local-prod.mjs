#!/usr/bin/env node
/**
 * Compara el CONTENIDO (no solo conteos) de tablas entre Local y Supabase.
 * Solo lectura: no modifica nada.
 *
 * Uso:
 *   PROD_DATABASE_URL='...' node db/scripts/compare-local-prod.mjs [tabla1 tabla2 ...]
 *   (sin argumentos compara TODAS las tablas en las que ambos lados tienen filas)
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { Client } = require(
  "/home/jk/Projects/dsi/mercaldas-ecommerce/backend/node_modules/pg",
);

const LOCAL_URL =
  process.env.LOCAL_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/ecommerce";
const PROD_URL = process.env.PROD_DATABASE_URL || "";

if (!PROD_URL) {
  console.error("Define PROD_DATABASE_URL");
  process.exit(1);
}

async function connect(url, ssl) {
  const c = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await c.connect();
  return c;
}

async function listTables(client) {
  const r = await client.query(
    `SELECT c.relname AS name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname`,
  );
  return r.rows.map((x) => x.name);
}

async function getPkColumns(client, table) {
  const r = await client.query(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE n.nspname = 'public' AND c.relname = $1 AND i.indisprimary
     ORDER BY array_position(i.indkey, a.attnum)`,
    [table],
  );
  return r.rows.map((x) => x.attname);
}

function rowHash(row, cols) {
  const h = createHash("sha256");
  for (const c of cols) {
    let v = row[c];
    if (v === undefined || v === null) v = "∅";
    else if (v instanceof Date) v = v.toISOString();
    else if (typeof v === "object") v = JSON.stringify(v);
    h.update(String(v));
    h.update("\x00");
  }
  return h.digest("hex");
}

async function main() {
  const src = await connect(LOCAL_URL, false);
  const dst = await connect(PROD_URL, { rejectUnauthorized: false });

  const srcTables = new Set(await listTables(src));
  const dstTables = new Set(await listTables(dst));

  const args = process.argv.slice(2);
  const tables = args.length
    ? args.filter((t) => srcTables.has(t) && dstTables.has(t))
    : [...srcTables].filter((t) => dstTables.has(t));

  console.log("Comparando contenido Local vs Supabase (solo lectura)...\n");
  let totalDiff = 0;

  for (const t of tables) {
    const cols = (
      await src.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [t],
      )
    ).rows.map((x) => x.column_name);
    if (!cols.length) continue;

    const pk = await getPkColumns(src, t);
    const keyCols = pk.length ? pk : cols.slice(0, 1);

    const a = (await src.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
    const b = (await dst.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;

    if (a === 0 && b === 0) continue;

    const [rowsA, rowsB] = await Promise.all([
      src.query(`SELECT * FROM "${t}"`),
      dst.query(`SELECT * FROM "${t}"`),
    ]);

    const mapA = new Map(rowsA.rows.map((r) => [keyCols.map((k) => String(r[k])).join("|"), r]));
    const mapB = new Map(rowsB.rows.map((r) => [keyCols.map((k) => String(r[k])).join("|"), r]));

    const onlyA = [];
    const onlyB = [];
    const changed = [];
    for (const [k, row] of mapA) {
      if (!mapB.has(k)) onlyA.push(k);
      else if (rowHash(row, cols) !== rowHash(mapB.get(k), cols)) changed.push(k);
    }
    for (const k of mapB.keys()) if (!mapA.has(k)) onlyB.push(k);

    const diffs = onlyA.length + onlyB.length + changed.length;
    if (diffs > 0) {
      totalDiff += diffs;
      console.log(`✗ ${t}  (local ${a} / supabase ${b})`);
      if (onlyB.length) console.log(`    solo en SUPABASE (${onlyB.length}): ${onlyB.slice(0, 8).join(", ")}${onlyB.length > 8 ? ", …" : ""}`);
      if (onlyA.length) console.log(`    solo en LOCAL (${onlyA.length}): ${onlyA.slice(0, 8).join(", ")}${onlyA.length > 8 ? ", …" : ""}`);
      if (changed.length) console.log(`    cambiadas (${changed.length}): ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? ", …" : ""}`);
    } else if (a > 0) {
      console.log(`✓ ${t}  (${a} filas idénticas)`);
    }
  }

  console.log(totalDiff ? `\n⚠ ${totalDiff} diferencias en total.` : "\n✅ Todo idéntico.");
  await src.end();
  await dst.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
