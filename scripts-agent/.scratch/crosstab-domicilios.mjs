#!/usr/bin/env node
/**
 * Crosstab de estados en DOMDIA/DOMITE de la copia de trabajo del ERP.
 * Sólo imprime conteos agregados (no vuelca filas).
 *
 * Uso: node scripts-agent/.scratch/crosstab-domicilios.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 0x190;
const DESC = 200;

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

function dec(rec, f) {
  const b = rec.subarray(f.offset, f.offset + f.length);
  switch (f.type) {
    case 0x04: return b.toString('latin1').replace(/\0/g, '').trimEnd();
    case 0x0b: return b.length >= 4 ? b.readInt32LE(0) : null;
    case 0x0a: return b.length >= 8 ? b.readDoubleLE(0) : null;
    case 0x01: return b[0] === 0x54 || b[0] === 0x31;
    case 0x0c: return b.length >= 2 ? b.readUInt16LE(0) : null;
    default: return b.toString('hex');
  }
}

function scan(file, wanted, onRow) {
  const t = open(file);
  const fields = wanted.map((n) => [n, t.fields.get(n)]);
  for (const [n, f] of fields) if (!f) throw new Error(`${path.basename(file)}: no existe ${n}`);
  const CHUNK = 20000;
  const buf = Buffer.alloc(Math.min(CHUNK, t.recCount) * t.recLen);
  for (let base = 0; base < t.recCount; base += CHUNK) {
    const count = Math.min(CHUNK, t.recCount - base);
    fs.readSync(t.fd, buf, 0, count * t.recLen, t.hdrLen + base * t.recLen);
    for (let j = 0; j < count; j++) {
      const rec = buf.subarray(j * t.recLen, (j + 1) * t.recLen);
      const row = {};
      for (const [n, f] of fields) row[n] = dec(rec, f);
      onRow(row);
    }
  }
  fs.closeSync(t.fd);
  return t;
}

const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const show = (title, m) => {
  console.log(`\n${title}`);
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(42)} ${v}`);
};

console.log('== DOMDIA ==');
const byEstado = new Map();
const estadoFactura = new Map();
const estadoTipo = new Map();
const estadoAnio = new Map();
const facturaPedido = new Map();
let demo = 0;
const t1 = scan(
  'db/ads/openads/data/domdia.adt',
  ['FACONTROL', 'FAFACTURA', 'FAESTADO', 'FATIPODOM', 'FAFCHFAC', 'FAPEDIDO'],
  (r) => {
    const isDemo = String(r.FACONTROL || '').startsWith('DEMO-');
    if (isDemo) demo++;
    const st = r.FAESTADO;
    inc(byEstado, st);
    inc(estadoFactura, `${st} | factura=${String(r.FAFACTURA || '').trim() ? 'sí' : 'no'}`);
    inc(estadoTipo, `${st} | tipodom=${String(r.FATIPODOM || '').trim() || 'vacío'}`);
    const y = String(r.FAFCHFAC || '').slice(0, 4);
    inc(estadoAnio, `${st} | ${y}`);
    const ped = String(r.FAPEDIDO || '');
    inc(facturaPedido, `pedido=${ped.length} chars${/ /.test(ped) ? ' con espacio' : ''}${/^\d+$/.test(ped) ? ' numérico' : ''}`);
  },
);
console.log(`registros=${t1.recCount} demo=${demo}`);
show('FAESTADO', byEstado);
show('FAESTADO | FAFACTURA', estadoFactura);
show('FAESTADO | FATIPODOM', estadoTipo);
show('FAESTADO | año', estadoAnio);
show('FAPEDIDO forma', facturaPedido);

console.log('\n== DOMITE ==');
const estadoItems = new Map();
const estadoItemsFactura = new Map();
const tipoItemsFactura = new Map();
const bodega = new Map();
const sucursal = new Map();
const t2 = scan(
  'db/ads/openads/data/domite.adt',
  ['IFESTADO', 'IFFACT', 'IFPEDIDO', 'IFTIPO', 'IFBODEGA', 'IFSUCUR'],
  (r) => {
    const st = r.IFESTADO;
    inc(estadoItems, st);
    inc(estadoItemsFactura, `${st} | factura=${String(r.IFFACT || '').trim() ? 'sí' : 'no'}`);
    inc(tipoItemsFactura, `tipo=${String(r.IFTIPO || '').trim() || 'vacío'} | factura=${String(r.IFFACT || '').trim() ? 'sí' : 'no'}`);
    inc(bodega, String(r.IFBODEGA || '').trim() || 'vacío');
    inc(sucursal, String(r.IFSUCUR || '').trim() || 'vacío');
  },
);
console.log(`registros=${t2.recCount}`);
show('IFESTADO', estadoItems);
show('IFESTADO | IFFACT', estadoItemsFactura);
show('IFTIPO | IFFACT', tipoItemsFactura);
show('IFBODEGA', bodega);
show('IFSUCUR', sucursal);
