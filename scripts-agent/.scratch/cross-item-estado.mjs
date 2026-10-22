#!/usr/bin/env node
/** Cruza DOMITE.IFFACT con DOMDIA.FAFACTURA para ver IFESTADO por estado de cabecera. */
import fs from 'node:fs';

const BASE = 0x190, DESC = 200;
function open(file) {
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
  return { fd, hdrLen, recLen, recCount, fields };
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
function each(file, wanted, cb) {
  const t = open(file);
  const fsx = wanted.map((n) => [n, t.fields.get(n)]);
  const CHUNK = 20000;
  const buf = Buffer.alloc(Math.min(CHUNK, t.recCount) * t.recLen);
  for (let base = 0; base < t.recCount; base += CHUNK) {
    const count = Math.min(CHUNK, t.recCount - base);
    fs.readSync(t.fd, buf, 0, count * t.recLen, t.hdrLen + base * t.recLen);
    for (let j = 0; j < count; j++) {
      const rec = buf.subarray(j * t.recLen, (j + 1) * t.recLen);
      const row = {};
      for (const [n, f] of fsx) row[n] = dec(rec, f);
      cb(row);
    }
  }
  fs.closeSync(t.fd);
}

const invState = new Map();
each('db/ads/openads/data/domdia.adt', ['FAFACTURA', 'FAESTADO'], (r) => {
  const inv = String(r.FAFACTURA || '').trim();
  if (inv) invState.set(inv, r.FAESTADO);
});
const cross = new Map();
each('db/ads/openads/data/domite.adt', ['IFFACT', 'IFESTADO'], (r) => {
  const st = invState.get(String(r.IFFACT || '').trim()) ?? 'sin-cabecera';
  const k = `cabecera=${st} | item=${r.IFESTADO}`;
  cross.set(k, (cross.get(k) || 0) + 1);
});
for (const [k, v] of [...cross.entries()].sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(42)} ${v}`);
