#!/usr/bin/env node
/**
 * Lee SOLO la cabecera de tablas Advantage (.adt) y extrae el diccionario de
 * campos (nombre, tipo, offset, longitud, decimales) + metadatos.
 *
 * No carga los datos: imprescindible para FADITE.ADT (5,7 GB).
 *
 * Uso:
 *   node scripts-agent/adt-fields.mjs            # todas las .ADT/.adt de db/ADD_ANALITICA
 *   node scripts-agent/adt-fields.mjs dir1 dir2  # directorios concretos
 *
 * Salidas: scripts-agent/.scratch/adt-fields/<TABLA>.json  (una por tabla)
 *          consola: resumen (tabla, n° campos, n° registros, bytes)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, '.scratch', 'adt-fields');

const BASE = 0x190;
const DESC = 200;
const TYPE_NAMES = {
  0x01: 'logical',
  0x02: 'date?',
  0x03: '?3',
  0x04: 'char',
  0x05: '?5',
  0x06: '?6',
  0x07: '?7',
  0x08: '?8',
  0x09: '?9',
  0x0a: 'double',
  0x0b: 'int32',
  0x0c: 'bin2',
  0x0d: '?13',
  0x0e: '?14',
  0x0f: '?15',
  0x10: '?16',
  0x11: '?17',
  0x12: '?18',
  0x13: '?19',
  0x14: '?20',
};

function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(0x4000);
    fs.readSync(fd, head, 0, head.length, 0);
    const recCount = head.readUInt32LE(0x18);
    const hdrLen = head.readUInt32LE(0x20);
    const recLen = head.readUInt32LE(0x24);
    const hdr = Buffer.alloc(hdrLen);
    fs.readSync(fd, hdr, 0, hdrLen, 0);
    const nfields = Math.max(0, Math.floor((hdrLen - BASE) / DESC));
    const fields = [];
    for (let i = 0; i < nfields; i++) {
      const o = BASE + i * DESC;
      if (o + DESC > hdr.length) break;
      let end = o;
      while (end < o + 0x80 && hdr[end] !== 0) end++;
      const name = hdr.toString('latin1', o, end).trim();
      if (!name) continue;
      const type = hdr[o + 0x81];
      fields.push({
        name,
        type,
        typeName: TYPE_NAMES[type] ?? `?${type}`,
        offset: hdr.readUInt16LE(o + 0x83),
        length: hdr[o + 0x87],
        decimals: hdr[o + 0x88],
      });
    }
    return { recCount, hdrLen, recLen, fields };
  } finally {
    fs.closeSync(fd);
  }
}

const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['db/ADD_ANALITICA'];

fs.mkdirSync(OUT_DIR, { recursive: true });
const summary = [];
for (const d of dirs) {
  const dir = path.isAbsolute(d) ? d : path.join(ROOT, d);
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/\.adt$/i.test(f)) continue;
    if (/\.BAK$/i.test(f)) continue;
    const full = path.join(dir, f);
    let info;
    try {
      info = readHeader(full);
    } catch (e) {
      summary.push({ file: f, error: String(e.message || e) });
      continue;
    }
    const table = f.replace(/\.[^.]+$/, '').toUpperCase();
    const bytes = fs.statSync(full).size;
    const out = {
      table,
      source: path.relative(ROOT, full),
      bytes,
      recordCount: info.recCount,
      recordLength: info.recLen,
      headerLength: info.hdrLen,
      fieldCount: info.fields.length,
      fields: info.fields,
    };
    fs.writeFileSync(path.join(OUT_DIR, `${table}.json`), JSON.stringify(out, null, 2));
    summary.push({ table, fields: info.fields.length, recs: info.recCount, recLen: info.recLen, mb: +(bytes / 1048576).toFixed(1) });
  }
}
summary.sort((a, b) => (a.table || '').localeCompare(b.table || ''));
for (const s of summary) {
  if (s.error) console.log(`${s.file}\tERROR\t${s.error}`);
  else console.log(`${s.table}\tcampos=${s.fields}\tregistros=${s.recs}\trecLen=${s.recLen}\t${s.mb}MB`);
}
console.log(`\nJSON en ${path.relative(ROOT, OUT_DIR)}/`);
