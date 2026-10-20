#!/usr/bin/env node
/**
 * Estadísticas de campos de una tabla Advantage (.adt) sin volcar registros.
 * Para campos char: top de valores. Para numéricos: min/max/nulos.
 *
 * Uso:
 *   node scripts-agent/adt-stats.mjs <archivo.adt> --fields=A,B,C [--maxScan=N] [--top=N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = 0x190;
const DESC = 200;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
if (!file) {
  console.error('Uso: node scripts-agent/adt-stats.mjs <archivo.adt> --fields=A,B [--maxScan=N] [--top=N]');
  process.exit(1);
}
const wanted = (opt('fields', '') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const maxScan = Number(opt('maxScan', 0)) || Infinity;
const top = Number(opt('top', 10));
const prefixSpec = opt('prefix', null); // "CAMPO:N" -> distribución de prefijos

const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
const fd = fs.openSync(full, 'r');
const head = Buffer.alloc(0x4000);
fs.readSync(fd, head, 0, head.length, 0);
const hdrLen = head.readUInt32LE(0x20);
const recLen = head.readUInt32LE(0x24);
const recCount = head.readUInt32LE(0x18);
const hdr = Buffer.alloc(hdrLen);
fs.readSync(fd, hdr, 0, hdrLen, 0);

const fields = new Map();
const n = Math.floor((hdrLen - BASE) / DESC);
for (let i = 0; i < n; i++) {
  const o = BASE + i * DESC;
  let end = o;
  while (end < o + 0x80 && hdr[end] !== 0) end++;
  const name = hdr.toString('latin1', o, end).trim();
  if (!name) continue;
  fields.set(name, { name, type: hdr[o + 0x81], offset: hdr.readUInt16LE(o + 0x83), length: hdr[o + 0x87] });
}

const decode = (rec, f) => {
  const b = rec.subarray(f.offset, f.offset + f.length);
  switch (f.type) {
    case 0x04: return b.toString('latin1').replace(/\0/g, '').trimEnd();
    case 0x0b: return b.length >= 4 ? b.readInt32LE(0) : null;
    case 0x0a: return b.length >= 8 ? b.readDoubleLE(0) : null;
    case 0x01: return b[0] === 0x54 || b[0] === 0x31;
    case 0x0c: return b.length >= 2 ? b.readUInt16LE(0) : null;
    default: return b.toString('hex');
  }
};

const stats = {};
for (const w of wanted) {
  const f = fields.get(w);
  if (!f) { stats[w] = { error: 'campo no existe' }; continue; }
  stats[w] = { type: f.type, length: f.length, values: new Map(), min: null, max: null, nulls: 0, n: 0, sum: 0 };
}
let prefixStat = null;
if (prefixSpec) {
  const [pf, pl] = prefixSpec.split(':');
  prefixStat = { field: pf.toUpperCase(), len: Number(pl) || 2, values: new Map() };
}

const scan = Math.min(recCount, maxScan);
const CHUNK = 20000; // registros por bloque

function readExactly(f, buffer, position) {
  let off = 0;
  while (off < buffer.length) {
    const n = fs.readSync(f, buffer, off, buffer.length - off, position + off);
    if (n <= 0) break;
    off += n;
  }
  return off;
}
const isNullish = (v, s) => (typeof v === 'number' ? (v === -2147483648 || v === -1.6e-322 || (s.type === 0x0a && Number.isNaN(v))) : String(v).trim() === '');

for (let base = 0; base < scan; base += CHUNK) {
  const count = Math.min(CHUNK, scan - base);
  const buf = Buffer.alloc(count * recLen);
  readExactly(fd, buf, hdrLen + base * recLen);
  for (let j = 0; j < count; j++) {
    const rec = buf.subarray(j * recLen, (j + 1) * recLen);
    for (const [k, s] of Object.entries(stats)) {
      if (s.error) continue;
      const v = decode(rec, fields.get(k));
      s.n++;
      if (isNullish(v, s)) { s.nulls++; continue; }
      if (s.type === 0x04) {
        s.values.set(v, (s.values.get(v) || 0) + 1);
      } else {
        if (s.min === null || v < s.min) s.min = v;
        if (s.max === null || v > s.max) s.max = v;
        s.sum += v;
        const key = String(v);
        s.values.set(key, (s.values.get(key) || 0) + 1);
      }
    }
    if (prefixStat) {
      const f = fields.get(prefixStat.field);
      if (f) {
        const v = String(decode(rec, f));
        const p = v.slice(0, prefixStat.len);
        prefixStat.values.set(p, (prefixStat.values.get(p) || 0) + 1);
      }
    }
  }
}
fs.closeSync(fd);

console.log(`== ${path.basename(file)} == registros=${recCount} recLen=${recLen} escaneados=${scan}`);
for (const [k, s] of Object.entries(stats)) {
  if (s.error) { console.log(`${k}: ${s.error}`); continue; }
  const topv = [...s.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  const line = `${k} [len=${s.length}] nulos/vacíos=${s.nulls}/${s.n}`;
  if (s.type === 0x04) console.log(`${line}\n  top: ${topv.map(([v, c]) => `"${v}"(${c})`).join(', ')}`);
  else console.log(`${line} min=${s.min} max=${s.max}\n  top: ${topv.map(([v, c]) => `${v}(${c})`).join(', ')}`);
}
if (prefixStat) {
  const topv = [...prefixStat.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  console.log(`prefijos(${prefixStat.len}) de ${prefixStat.field}: ${topv.map(([v, c]) => `"${v}"(${c})`).join(', ')}`);
}
