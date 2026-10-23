import { createPg } from './openads.mjs';
const pg = createPg();
await pg.connect();

const cols = await pg.query(
  `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'erp_outbox' ORDER BY ordinal_position`,
);
console.log('=== columnas erp_outbox ===');
for (const r of cols.rows) console.log(r.column_name + ' ' + r.data_type);

const agg = await pg.query(
  `SELECT kind, status, count(*) AS c FROM erp_outbox GROUP BY kind, status ORDER BY c DESC LIMIT 40`,
);
console.log('=== erp_outbox por kind/estado ===');
for (const r of agg.rows) console.log(JSON.stringify(r));
await pg.end();
