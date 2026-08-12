#!/usr/bin/env node
/**
 * Lista TODOS los assets de Cloudinary (Admin API) y los asocia
 * con los productos actuales por external_id o plu.
 *
 * Uso: TARGET_DATABASE_URL='...' [TARGET_DB_SSL=1] node recover-images-cloudinary-api.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require(
  "/home/jk/Projects/dsi/mercaldas-ecommerce/backend/node_modules/pg",
);
const cloudinary = require(
  "/home/jk/Projects/dsi/mercaldas-ecommerce/backend/node_modules/cloudinary",
).v2;

cloudinary.config({
  cloud_name: "yz7xzppt",
  api_key: "281695198199145",
  api_secret: "x3mNN2UTwB4BoR-RbUm66PwVnfw",
});

const TARGET_URL = process.env.TARGET_DATABASE_URL || "";
const TARGET_SSL = process.env.TARGET_DB_SSL === "1";
const DRY_RUN = process.env.DRY_RUN === "1";

function fail(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }

async function connect(url, ssl) {
  const c = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await c.connect();
  return c;
}

async function listAllAssets(prefix) {
  const all = [];
  let nc = undefined, page = 0;
  do {
    page++;
    const r = await cloudinary.api.resources({ type: "upload", prefix, max_results: 500, next_cursor: nc });
    all.push(...r.resources);
    nc = r.next_cursor;
    console.log(`   pág ${page}: ${r.resources.length} (total ${all.length})`);
    if (nc) await new Promise((res) => setTimeout(res, 400));
  } while (nc);
  return all;
}

async function main() {
  if (!TARGET_URL) fail("Define TARGET_DATABASE_URL");
  console.log("━━━ Cloudinary Admin API → productos ━━━");

  const assets = await listAllAssets("products/");
  console.log(`Total: ${assets.length}`);

  const byEid = new Map(), byPlu = new Map();
  let n = 0;
  for (const a of assets) {
    const parts = a.public_id.split("/");
    if (parts.length < 3 || parts[0] !== "products") continue;
    const plu = parts[1];
    const last = parts[parts.length - 1];
    const m = last.match(/^prod_(.+)$/);
    if (!m) continue;
    n++;
    const eid = m[1];
    if (!byEid.has(eid)) byEid.set(eid, []);
    byEid.get(eid).push(a.secure_url);
    if (!byPlu.has(plu)) byPlu.set(plu, []);
    byPlu.get(plu).push(a.secure_url);
  }
  console.log(`Productos: ${n} | eids: ${byEid.size} | plus: ${byPlu.size}`);

  const dst = await connect(TARGET_URL, TARGET_SSL ? { rejectUnauthorized: false } : false);
  const covers = await dst.query(`SELECT DISTINCT product_id FROM product_images WHERE is_cover=true`);
  const coverSet = new Set(covers.rows.map((r) => Number(r.product_id)));

  const prods = await dst.query(`SELECT id, external_id, plu FROM products WHERE deleted_at IS NULL`);
  console.log(`Destino: ${prods.rows.length} (${coverSet.size} con cover)`);

  let matched = 0, inserted = 0;
  for (const p of prods.rows) {
    const pid = Number(p.id);
    if (coverSet.has(pid)) { matched++; continue; }
    const urls = (p.external_id && byEid.get(String(p.external_id))) ||
                 (p.plu && byPlu.get(String(p.plu)));
    if (!urls) continue;
    matched++;
    const url = urls[0];
    if (DRY_RUN) continue;

    const fn = url.split("/").pop()?.slice(0, 250) || "img";
    const chk = `api_${pid}_${Date.now().toString(36)}`;
    const ex = await dst.query(`SELECT id FROM media WHERE path=$1`, [url]);
    let mid;
    if (ex.rows.length) {
      mid = Number(ex.rows[0].id);
    } else {
      const ins = await dst.query(
        `INSERT INTO media (status,media_type,provider,path,file_name,mime_type,size_bytes,checksum,is_public)
         VALUES ('active','image','cloudinary',$1,$2,'image/jpeg',0,$3,true) RETURNING id`,
        [url, fn, chk]);
      mid = Number(ins.rows[0].id);
    }
    const re = await dst.query(`SELECT 1 FROM product_images WHERE product_id=$1 AND is_cover=true LIMIT 1`, [pid]);
    if (re.rows.length) continue;
    await dst.query(`INSERT INTO product_images (product_id,media_id,is_cover,position) VALUES ($1,$2,true,0)`, [pid, mid]);
    inserted++;
  }
  console.log(`\n✅ Coincidencias: ${matched}${DRY_RUN ? "" : " (insertadas " + inserted + ")"}`);
  console.log(`Sin imagen: ${prods.rows.length - matched}`);
  await dst.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
