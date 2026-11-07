// Inventario de endpoints del backend a partir de los controladores.
// Uso: node scripts-agent/list-endpoints.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'backend/src/modules';
const HTTP = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?/g;

const rows = [];
for (const mod of readdirSync(ROOT)) {
  const dir = join(ROOT, mod);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.controller.ts')) continue;
    const src = readFileSync(join(dir, file), 'utf8');
    const base = (src.match(/@Controller\(\s*'([^']*)'/) || [, ''])[1];
    let m;
    const re = new RegExp(HTTP.source, 'g');
    while ((m = re.exec(src))) {
      const [, verb, path] = m;
      rows.push({ mod, verb: verb.toUpperCase(), path: `/${base}${path ? '/' + path : ''}` });
    }
  }
}

rows.sort((a, b) => a.mod.localeCompare(b.mod) || a.path.localeCompare(b.path));
const byMod = {};
for (const r of rows) (byMod[r.mod] ??= []).push(r);

console.log(`Total: ${rows.length} endpoints en ${Object.keys(byMod).length} módulos\n`);
for (const [mod, list] of Object.entries(byMod)) {
  console.log(`## ${mod} (${list.length})`);
  for (const r of list) console.log(`  ${r.verb.padEnd(6)} ${r.path}`);
}
