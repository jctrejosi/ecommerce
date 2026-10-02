/**
 * Codemod de una sola pasada: reemplaza en el admin de picking las clases
 * Tailwind con hex fijo por los tokens semánticos del tema (ver `src/index.css`).
 *
 * Uso: node scripts-agent/map-picking-admin-theme-colors.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../Interface web picking admin/src');

const REPLACEMENTS = [
  ['bg-[#0C0C0D]', 'bg-app'],
  ['text-[#0C0C0D]', 'text-on-accent'],
  ['border-[#0C0C0D]', 'border-app'],
  ['bg-[#161618]', 'bg-surface'],
  ['bg-[#141416]', 'bg-surface-alt'],
  ['bg-[#141518]', 'bg-surface-alt'],
  ['bg-[#111113]', 'bg-surface-alt'],
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

let total = 0;
for (const file of walk(ROOT)) {
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  let perFile = 0;
  for (const [from, to] of REPLACEMENTS) {
    const parts = text.split(from);
    const n = parts.length - 1;
    if (n > 0) {
      perFile += n;
      text = parts.join(to);
    }
  }
  if (text !== before) {
    fs.writeFileSync(file, text);
    total += perFile;
    console.log(`  ${perFile.toString().padStart(3)}  ${path.relative(ROOT, file)}`);
  }
}

console.log(`\nTotal de reemplazos: ${total}`);

// Restos: clases con hex que hayan quedado sin mapear.
const leftovers = new Map();
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/[a-z]+-\[#[0-9A-Fa-f]{6}\]/g)) {
    leftovers.set(m[0], (leftovers.get(m[0]) ?? 0) + 1);
  }
}
if (leftovers.size > 0) {
  console.log('\nClases con hex restantes:');
  for (const [k, v] of [...leftovers].sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`);
} else {
  console.log('\nSin clases con hex restantes en los .tsx.');
}
