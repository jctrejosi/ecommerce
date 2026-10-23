import { createPg } from './openads.mjs';
const pg = createPg();
await pg.connect();

const q = await pg.query(
  `SELECT
     count(*) FILTER (WHERE strpos(name, '?') > 0 AND deleted_at IS NULL) AS qmark_active,
     count(*) FILTER (WHERE strpos(name, chr(65533)) > 0 AND deleted_at IS NULL) AS fffd_active,
     count(*) FILTER (WHERE strpos(name, '?') > 0 AND deleted_at IS NOT NULL) AS qmark_soft,
     count(*) AS total_active
   FROM brands`,
);
console.log('brands:', JSON.stringify(q.rows[0]));

// muestra de marcas activas con '?'
const s = await pg.query(
  `SELECT id, code, name FROM brands WHERE strpos(name, '?') > 0 AND deleted_at IS NULL ORDER BY id LIMIT 20`,
);
console.log('=== marcas activas con "?" ===');
for (const r of s.rows) console.log(`${r.id}\t${r.code}\t${JSON.stringify(r.name)}`);
await pg.end();
