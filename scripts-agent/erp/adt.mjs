/**
 * Lector mínimo de tablas Advantage (.ADT) para los diccionarios del ERP.
 *
 * Lee la cabecera y decodifica sólo los campos pedidos (char, logical, int32,
 * double, bin2). No usa el servidor OpenADS: sirve para trabajar con las copias
 * de las tablas-diccionario de FORTUNER que viven en `db/ads/fortuner-dicts`.
 */
import fs from 'node:fs';

const BASE = 0x190;
const DESC = 200;

/**
 * @param {string} file ruta al .ADT
 * @param {string[]} [wanted] nombres de campo a decodificar (si se omite, todos)
 * @returns {{ recordCount: number, recordLength: number, fields: object[], rows: object[] }}
 */
export function readAdt(file, wanted = null) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(0x4000);
    fs.readSync(fd, head, 0, head.length, 0);
    const hdrLen = head.readUInt32LE(0x20);
    const recLen = head.readUInt32LE(0x24);
    const recCount = head.readUInt32LE(0x18);
    const hdr = Buffer.alloc(hdrLen);
    fs.readSync(fd, hdr, 0, hdrLen, 0);

    const all = [];
    for (let i = 0; ; i++) {
      const o = BASE + i * DESC;
      if (o >= hdrLen) break;
      let end = o;
      while (end < o + 0x80 && hdr[end] !== 0) end++;
      const name = hdr.toString('latin1', o, end).trim();
      if (!name) continue;
      all.push({
        name,
        type: hdr[o + 0x81],
        offset: hdr.readUInt16LE(o + 0x83),
        length: hdr[o + 0x87],
        decimals: hdr[o + 0x88],
      });
    }

    const byName = new Map(all.map((f) => [f.name.toUpperCase(), f]));
    const fields = wanted
      ? wanted.map((n) => {
          const f = byName.get(String(n).toUpperCase());
          if (!f) throw new Error(`${file}: no existe el campo ${n}`);
          return f;
        })
      : all;

    const rows = [];
    const CHUNK = 20000;
    const buf = Buffer.alloc(Math.max(1, Math.min(CHUNK, recCount)) * recLen);
    for (let base = 0; base < recCount; base += CHUNK) {
      const count = Math.min(CHUNK, recCount - base);
      readExactly(fd, buf.subarray(0, count * recLen), hdrLen + base * recLen);
      for (let j = 0; j < count; j++) {
        const rec = buf.subarray(j * recLen, (j + 1) * recLen);
        const row = {};
        for (const f of fields) row[f.name] = decode(rec, f);
        rows.push(row);
      }
    }
    return { recordCount: recCount, recordLength: recLen, fields: all, rows };
  } finally {
    fs.closeSync(fd);
  }
}

function readExactly(fd, buffer, position) {
  let off = 0;
  while (off < buffer.length) {
    const n = fs.readSync(fd, buffer, off, buffer.length - off, position + off);
    if (n <= 0) break;
    off += n;
  }
  return off;
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
      return b[0] === 0x54 || b[0] === 0x31; // 'T' / '1'
    case 0x0c:
      return b.length >= 2 ? b.readUInt16LE(0) : null;
    default:
      return b.toString('hex');
  }
}
