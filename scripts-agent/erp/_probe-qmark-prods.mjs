import { createPg } from './openads.mjs';
const pg = createPg();
await pg.connect();
const r = await pg.query(
  `SELECT count(*) AS qmark_brands_with_products
     FROM brands b
    WHERE strpos(b.name, '?') > 0 AND b.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM products p WHERE p.brand_id = b.id AND p.deleted_at IS NULL)`,
);
console.log('marcas "?" activas con productos:', r.rows[0].qmark_brands_with_products);

const s = await pg.query(
  `SELECT count(*) AS total_prods_on_qmark
     FROM products p JOIN brands b ON b.id = p.brand_id
    WHERE strpos(b.name, '?') > 0 AND b.deleted_at IS NULL AND p.deleted_at IS NULL`,
);
console.log('productos bajo marcas "?":', s.rows[0].total_prods_on_qmark);
await pg.end();
