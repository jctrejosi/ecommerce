import { createErpClient } from './openads.mjs';
const erp = createErpClient({ mode: 'asqlcmd' });

const codes = ['2001711', '2001712', '325', '2001545', '76', '2000153'];
for (const c of codes) {
  const r = await erp.sql(`SELECT MCODIGO, MNOMBRE FROM tidmarcas WHERE MCODIGO = '${c}'`, { limit: 10 });
  for (const row of r.rows) {
    const name = row[1];
    const bytes = [...Buffer.from(name, 'latin1')].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const chars = [...name].map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
    console.log(`${row[0]}  len=${name.length}  "${name}"`);
    console.log(`   bytes: ${bytes}`);
    console.log(`   chars: ${chars}`);
  }
}
