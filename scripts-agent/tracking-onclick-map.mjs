/**
 * Genera `docs/tracking/onclick-map.md`: inventario de todas las interacciones
 * `onClick` (y `onSubmit`) del cliente web, agrupadas por archivo/componente.
 *
 * Se usa el compilador de TypeScript (AST) en lugar de regex para no confundir
 * atributos dentro de strings ni perder handlers multilínea.
 *
 * Uso (desde la raíz del repo):
 *   node scripts-agent/tracking-onclick-map.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CLIENT_SRC = path.join(ROOT, 'Interface web client', 'src');
const OUT = path.join(ROOT, 'docs', 'tracking', 'onclick-map.md');

const require = createRequire(path.join(ROOT, 'backend', 'package.json'));
const ts = require('typescript');

const FILES = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && full.endsWith('.tsx')) FILES.push(full);
  }
})(CLIENT_SRC);

const rel = (p) => path.relative(ROOT, p).replaceAll(path.sep, '/');
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const escapeCell = (s) => String(s).replaceAll('|', '\\|');

function literalText(node) {
  if (!node) return '';
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isJsxExpression(node) && node.expression) {
    if (ts.isStringLiteral(node.expression)) return node.expression.text;
  }
  if (ts.isJsxExpression(node)) return '';
  return '';
}

function attrText(node, name) {
  for (const a of node.attributes.properties) {
    if (!ts.isJsxAttribute(a)) continue;
    if (a.name.getText() !== name) continue;
    return literalText(a.initializer);
  }
  return '';
}

/** Texto visible de los hijos directos de un JSX (para etiquetar botones). */
function childrenLabel(jsx) {
  if (!jsx || !ts.isJsxElement(jsx)) return '';
  const parts = [];
  const collect = (children) => {
    for (const child of children) {
      if (ts.isJsxText(child)) {
        const t = oneLine(child.getText());
        if (t) parts.push(t);
      } else if (ts.isJsxExpression(child) && child.expression) {
        if (ts.isStringLiteral(child.expression)) parts.push(child.expression.text);
      } else if (ts.isJsxElement(child)) {
        const t = attrText(child.openingElement, 'aria-label') || childrenLabel(child);
        if (t) parts.push(t);
      } else if (ts.isJsxSelfClosingElement(child)) {
        const t = attrText(child, 'aria-label') || attrText(child, 'title');
        if (t) parts.push(t);
      }
      if (parts.join(' ').length > 90) return;
    }
  };
  collect(jsx.children);
  return oneLine(parts.join(' '));
}

function nearestComponent(node) {
  let n = node.parent;
  while (n) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.getText();
    if (ts.isMethodDeclaration(n) && n.name) return n.name.getText();
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const init = n.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        return n.name.getText();
      }
    }
    n = n.parent;
  }
  return '—';
}

function handlerSummary(attr) {
  if (!attr.initializer) return '';
  const raw = oneLine(attr.initializer.getText());
  return clip(raw, 140);
}

const rows = [];
for (const file of FILES) {
  const code = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      for (const a of node.attributes.properties) {
        if (!ts.isJsxAttribute(a)) continue;
        const name = a.name.getText();
        if (name !== 'onClick' && name !== 'onSubmit') continue;
        const tag = node.tagName.getText();
        const label =
          attrText(node, 'aria-label') ||
          attrText(node, 'title') ||
          attrText(node, 'placeholder') ||
          childrenLabel(node.parent) ||
          (tag[0] === tag[0].toUpperCase() ? tag : '');
        const line = sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1;
        rows.push({
          file: rel(file),
          line,
          component: nearestComponent(node),
          tag,
          event: name,
          label: clip(label || '—', 70),
          handler: handlerSummary(a) || '—',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

rows.sort((x, y) => (x.file === y.file ? x.line - y.line : x.file.localeCompare(y.file)));

const byFile = new Map();
for (const r of rows) {
  if (!byFile.has(r.file)) byFile.set(r.file, { click: 0, submit: 0 });
  const c = byFile.get(r.file);
  if (r.event === 'onClick') c.click++;
  else c.submit++;
}

const clicks = rows.filter((r) => r.event === 'onClick').length;
const submits = rows.length - clicks;

const lines = [];
lines.push('# Mapa de interacciones del cliente web (`onClick` / `onSubmit`)');
lines.push('');
lines.push(
  '> Documento generado automáticamente desde el código con ' +
    '`node scripts-agent/tracking-onclick-map.mjs`. No editar a mano: ' +
    'regenerar tras cambios en la interfaz.',
);
lines.push('');
lines.push(`- **Total:** ${rows.length} interacciones (${clicks} \`onClick\`, ${submits} \`onSubmit\`).`);
lines.push(`- **Archivos:** ${byFile.size}.`);
lines.push('');
lines.push('## Resumen por archivo');
lines.push('');
lines.push('| Archivo | onClick | onSubmit | Total |');
lines.push('| --- | ---: | ---: | ---: |');
for (const [file, c] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`| \`${file}\` | ${c.click} | ${c.submit} | ${c.click + c.submit} |`);
}
lines.push('');
lines.push('## Detalle');
lines.push('');

let current = '';
for (const r of rows) {
  if (r.file !== current) {
    current = r.file;
    lines.push(`### \`${r.file}\``);
    lines.push('');
    lines.push('| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |');
    lines.push('| ---: | --- | --- | --- | --- | --- |');
  }
  lines.push(
    `| ${r.line} | ${escapeCell(r.component)} | \`${escapeCell(r.tag)}\` | ${escapeCell(r.label)} | \`${escapeCell(r.handler)}\` | ${r.event} |`,
  );
}
lines.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

// Resumen para la terminal (no volcar el documento completo).
console.log(`OK → ${rel(OUT)}`);
console.log(`Interacciones: ${rows.length} (onClick=${clicks}, onSubmit=${submits})`);
console.log(`Archivos con interacciones: ${byFile.size}`);
console.log('Top archivos por cantidad:');
for (const [file, c] of [...byFile.entries()].sort((a, b) => b[1].click + b[1].submit - (a[1].click + a[1].submit)).slice(0, 8)) {
  console.log(`  ${c.click + c.submit}  ${file}`);
}
