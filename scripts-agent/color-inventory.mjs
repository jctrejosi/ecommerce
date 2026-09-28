// Inventario de clases de color usadas en analytics/src para diseñar los temas.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "Interface web analytics/src";
const families = new Map(); // family -> count
const prefixCount = new Map(); // utility prefix -> count

function bump(m, k, n = 1) { m.set(k, (m.get(k) || 0) + n); }

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx?)$/.test(name)) {
      const txt = readFileSync(p, "utf8");
      // utilidades tipo text-amber-400, bg-amber-50/40, border-amber-300, from-amber-400, ring-amber-300
      const re = /\b(text|bg|border|from|to|via|ring|fill|stroke|shadow|outline|divide|decoration|accent|caret|placeholder)-([a-z]+)-(\d{2,3})\b/g;
      let m;
      while ((m = re.exec(txt))) {
        bump(prefixCount, m[1]);
        bump(families, m[2]);
      }
    }
  }
}

walk(ROOT);

const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
console.log("Prefijos de utilidad (top):");
for (const [k, v] of sortDesc(prefixCount)) console.log(`  ${String(v).padStart(4)}  ${k}-`);
console.log("\nFamilias de color (top 25):");
for (const [k, v] of sortDesc(families).slice(0, 25)) console.log(`  ${String(v).padStart(4)}  ${k}-`);
