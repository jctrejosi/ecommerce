/**
 * Auditoría de elementos clicables: busca `onClick` en archivos .tsx y reporta
 * la etiqueta JSX que lo contiene (heurística: el último `<Tag` antes del
 * `onClick`). Sirve para detectar elementos que no son `<button>` y que por
 * tanto no heredan el `cursor: pointer` que Tailwind v4 ya no aplica solo.
 *
 * Uso: node scripts-agent/audit-clickable-elements.cjs "Interface web delivery admin/src"
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('Indica al menos un directorio.');
  process.exit(1);
}

/** Extrae el texto de la etiqueta de apertura que empieza en `start`. */
function openingTag(src, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' || c === '(') depth++;
    else if (c === '}' || c === ')') depth--;
    else if (c === '>' && depth <= 0) return src.slice(start, i + 1);
  }
  return src.slice(start, start + 800);
}

/** Etiquetas que ya son interactivas por naturaleza. */
const NATIVAS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary', 'option']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

const porEtiqueta = new Map();
const detalle = [];

for (const rel of dirs) {
  const base = path.join(ROOT, rel);
  if (!fs.existsSync(base)) {
    console.warn(`(no existe: ${rel})`);
    continue;
  }
  for (const file of walk(base)) {
    const src = fs.readFileSync(file, 'utf8');
    const lineas = src.split('\n');
    let idx = -1;
    while ((idx = src.indexOf('onClick', idx + 1)) !== -1) {
      // Último `<Tag` antes del onClick (máx. 1200 caracteres atrás).
      const desde = Math.max(0, idx - 1200);
      const previo = src.slice(desde, idx);
      const m = [...previo.matchAll(/<([A-Za-z][\w.]*)/g)].pop();
      if (!m) continue;
      const tag = m[1];
      const tagStart = desde + m.index;
      const linea = src.slice(0, idx).split('\n').length;
      porEtiqueta.set(tag, (porEtiqueta.get(tag) ?? 0) + 1);
      if (!NATIVAS.has(tag) && tag !== 'Button') {
        const apertura = openingTag(src, tagStart);
        const yaTieneCursor = /cursor-/.test(apertura);
        detalle.push(
          `${path.relative(ROOT, file)}:${linea}  <${tag}>  ${yaTieneCursor ? '(ya tiene cursor-*)' : 'SIN cursor-*'}`,
        );
      }
    }
  }
}

console.log('== onClick por etiqueta ==');
for (const [tag, n] of [...porEtiqueta.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  <${tag}>`);
}
console.log(`\n== onClick en elementos NO interactivos (${detalle.length}) ==`);
for (const d of detalle) console.log(`  ${d}`);
const sinCursor = detalle.filter((d) => d.includes('SIN cursor-*'));
console.log(`\n  de ellos SIN cursor-*: ${sinCursor.length}`);

// Resumen por archivo, de mayor a menor.
const porArchivo = new Map();
for (const d of sinCursor) {
  const archivo = d.split('  <')[0].split(':')[0];
  porArchivo.set(archivo, (porArchivo.get(archivo) ?? 0) + 1);
}
console.log('\n== SIN cursor-*, por archivo ==');
for (const [f, n] of [...porArchivo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(n).padStart(3)}  ${f}`);
}
