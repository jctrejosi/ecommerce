#!/usr/bin/env node
/**
 * Muestrea registros de una tabla Advantage (.adt) SIN volcar toda la tabla.
 * Decodifica por tipo y permite filtrar/limitar.
 *
 * Uso:
 *   node scripts-agent/adt-sample.mjs <archivo.adt> [--last=N] [--first=N]
 *        [--where=CAMPO=VALOR] [--fields=A,B,C]
 *
 * Ej:
 *   node scripts-agent/adt-sample.mjs db/ADD_ANALITICA/DOMDIA.ADT --last=3
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
if (!file) {
  console.error('Uso: node scripts-agent/adt-sample.mjs <archivo.adt> [--last=N] [--where=CAMPO=VALOR] [--fields=A,B]');
  process.exit(1);
}
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};

const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
const fd = fs.openSync(full, 'r');
const fileSize = fs.fstatSync(fd).size;
const head = Buffer.alloc(0x4000);
fs.readSync(fd, head, 0, head.length, 0);
const hdrLen = head.readUInt32LE(0x20);
const recLen = head.readUInt32LE(0x24);
const recCount = head.readUInt32LE(0x18);
const hdr = Buffer.alloc(hdrLen);
fs.readSync(fd, hdr, 0, hdrLen, 0);

// Lee un rango de registros sin cargar el archivo completo (FADITE > 5 GB).
const readRecords = (from, count) => {
  const buf = Buffer.alloc(count * recLen);
  fs.readSync(fd, buf, 0, buf.length, hdrLen + from * recLen);
  return buf;
};

const fields = [];
const n = Math.floor((hdrLen - BASE) / DESC);
for (let i = 0; i < n; i++) {
  const o = BASE + i * DESC;
  let end = o;
  while (end < o + 0x80 && hdr[end] !== 0) end++;
  const name = hdr.toString('latin1', o, end).trim();
  if (!name) continue;
  fields.push({ name, type: hdr[o + 0x81], offset: hdr.readUInt16LE(o + 0x83), length: hdr[o + 0x87], decimals: hdr[o + 0x88] });
}

function decode(rec, f) {
  const b = rec.subarray(f.offset, f.offset + f.length);
  switch (f.type) {
    case 0x04:
      return b.toString('latin1').replace(/\0/g, '').trimEnd();
    case 0x0b:
      return b.length >= 4 ? b.readInt32LE(0) : null;
    case 0x0a:
      return b.length >= 8 ? b.readDoubleLE(0) : null;
    case 0x01:
      return b[0] === 0x54 || b[0] === 0x31; // 'T'/'1'
    case 0x0c:
      return b.length >= 2 ? b.readUInt16LE(0) : null;
    default:
      return b.toString('hex');
  }
}

const rec = (buf, i) => buf.subarray(i * recLen, (i + 1) * recLen);

const last = Number(opt('last', 0));
const first = Number(opt('first', 0));
const where = opt('where', null);
const onlyFields = opt('fields', null)?.split(',').map((s) => s.trim().toUpperCase());
let list = onlyFields ? fields.filter((f) => onlyFields.includes(f.name)) : fields;
if (!list.length) list = fields;

const limit = last || first || 5;
const start = last ? Math.max(0, recCount - last) : 0;
const windowCount = last ? Math.min(last, recCount) : Math.min(recCount, limit, first || 5);
const buf = readRecords(start, windowCount);
let printed = 0;
for (let i = 0; i < windowCount && printed < limit; i++) {
  const r = rec(buf, i);
  const obj = {};
  for (const f of list) obj[f.name] = decode(r, f);
  if (where) {
    const [k, v] = where.split('=');
    if (String(obj[k.toUpperCase()]) !== v) continue;
  }
  console.log(`--- #${start + i + 1}/${recCount} ---`);
  console.log(JSON.stringify(obj, null, 1));
  printed++;
}
fs.closeSync(fd);
console.log(`\n(campos: ${fields.length}; registros: ${recCount}; recLen: ${recLen}; ${(fileSize / 1048576).toFixed(1)} MB)`);
