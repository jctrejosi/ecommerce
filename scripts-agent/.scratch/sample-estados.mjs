#!/usr/bin/env node
/** Muestras cortas por FAESTADO en DOMDIA (sólo 3 filas por estado). */
import fs from 'node:fs';

const file = 'db/ads/openads/data/domdia.adt';
const BASE = 0x190, DESC = 200;
const fd = fs.openSync(file, 'r');
const head = Buffer.alloc(0x4000);
fs.readSync(fd, head, 0, head.length, 0);
const hdrLen = head.readUInt32LE(0x20);
const recLen = head.readUInt32LE(0x24);
const recCount = head.readUInt32LE(0x18);
const hdr = Buffer.alloc(hdrLen);
fs.readSync(fd, hdr, 0, hdrLen, 0);
const fields = new Map();
for (let i = 0; ; i++) {
  const o = BASE + i * DESC;
  if (o >= hdrLen) break;
  let end = o;
  while (end < o + 0x80 && hdr[end] !== 0) end++;
  const name = hdr.toString('latin1', o, end).trim();
  if (!name) continue;
  fields.set(name, { type: hdr[o + 0x81], offset: hdr.readUInt16LE(o + 0x83), length: hdr[o + 0x87] });
}
const dec = (rec, f) => {
  const b = rec.subarray(f.offset, f.offset + f.length);
  switch (f.type) {
    case 0x04: return b.toString('latin1').replace(/\0/g, '').trimEnd();
    case 0x0b: return b.readInt32LE(0);
    case 0x0a: return b.readDoubleLE(0);
    case 0x01: return b[0] === 0x54 || b[0] === 0x31;
    case 0x0c: return b.readUInt16LE(0);
    default: return b.toString('hex');
  }
};
const wanted = ['FAPEDIDO', 'FAFACTURA', 'FAESTADO', 'FATIPODOM', 'FAFCHFAC', 'FAVLRBRU', 'FAVLRIVA', 'FAVLRNET', 'FAOBSER', 'FACONTROL', 'FANOMBRE'];
const samples = new Map();
const CHUNK = 20000;
const buf = Buffer.alloc(Math.min(CHUNK, recCount) * recLen);
for (let base = 0; base < recCount; base += CHUNK) {
  const count = Math.min(CHUNK, recCount - base);
  fs.readSync(fd, buf, 0, count * recLen, hdrLen + base * recLen);
  for (let j = 0; j < count; j++) {
    const rec = buf.subarray(j * recLen, (j + 1) * recLen);
    const st = dec(rec, fields.get('FAESTADO'));
    const arr = samples.get(st) || [];
    if (arr.length >= 3) continue;
    const row = {};
    for (const n of wanted) row[n] = dec(rec, fields.get(n));
    arr.push(row);
    samples.set(st, arr);
  }
}
fs.closeSync(fd);
for (const [st, arr] of [...samples.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`\n== FAESTADO ${st} ==`);
  for (const r of arr) console.log(JSON.stringify(r));
}
