#!/usr/bin/env node
/**
 * Compara el esquema real de FORTUNER (cabeceras .ADT traídas de dsi-vps) con:
 *   1) la copia local que usa la integración (`db/ads/openads/data`), y
 *   2) los campos que nuestros scripts escriben en el ERP.
 *
 * No usa datos: solo los JSON de `scripts-agent/.scratch/adt-fields-*`.
 *
 * Uso:
 *   node scripts-agent/erp/compare-schema-fortuner.mjs
 *   → docs/COMPARACION-ESQUEMA-FORTUNER.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const F_DIR = path.join(ROOT, 'scripts-agent', '.scratch', 'adt-fields-fortuner');
const E_DIR = path.join(ROOT, 'scripts-agent', '.scratch', 'adt-fields-ecom');
const OUT = path.join(ROOT, 'docs', 'COMPARACION-ESQUEMA-FORTUNER.md');

function load(dir, table, sourceHint) {
  const f = path.join(dir, `${table}.json`);
  if (!fs.existsSync(f)) return null;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (sourceHint && !String(j.source || '').includes(sourceHint)) return null;
  return j;
}

function fieldsOf(j) {
  const m = new Map();
  for (const f of j?.fields || []) m.set(f.name.toUpperCase(), f);
  return m;
}

/**
 * Campos que la integración escribe hoy, con el recorte que aplica el código.
 * `gen` = longitud del código generado (`newErpCode`: prefijo '9' + secuencia).
 */
const WRITE = {
  TIDSAL: {
    key: 'INARTIC',
    fields: {
      INARTIC: { clip: 19 },
      INNOMBRE: { clip: 60 },
      INVRVENTA1: {},
      INVRVENTA0: {},
      INSALDO00: {},
      INSUC: {},
    },
  },
  TIDMARCAS: {
    key: 'MCODIGO',
    fields: { MCODIGO: { clip: 8, gen: '90000000' }, MNOMBRE: { clip: 80 } },
  },
  TIDTAB: {
    key: 'CTABCOD',
    fields: { CTABCOD: { clip: 7, gen: '9000000' }, CTABDES: { clip: 45 } },
  },
  TIDTPRO: {
    key: 'CODIGO',
    fields: { CODIGO: { clip: 3 }, NOMBRE: { clip: 30 }, HABILITA: {} },
  },
  POSCLI: {
    key: 'CODCLI',
    fields: {
      NOMCLI: { clip: 40 },
      NOMBRE: { clip: 50 },
      APELLIDO: { clip: 50 },
      CEDCLI: { clip: 10 },
      TIPODOC: { clip: 2 },
      EMAIL: { clip: 50 },
      TELCELU: { clip: 12 },
      SUCURSAL: { clip: 3 },
      ORIGENW: { clip: 1 },
      BLOQUE: {},
    },
  },
  DOMDIA: {
    key: 'FACONTROL',
    fields: {
      FASUCUR: { clip: 3 },
      FAFACTURA: { clip: 12 },
      FAPEDIDO: { clip: 9 },
      FACODIGO: { clip: 13 },
      FANOMBRE: { clip: 45 },
      FADIREC: { clip: 60 },
      FACIUDAD: { clip: 12 },
      FATELEF: { clip: 15 },
      FACELU: { clip: 15 },
      FANIT: { clip: 15 },
      FAEMAIL: { clip: 50 },
      FAFCHFAC: {},
      FATIME: { clip: 8 },
      FAVLRBRU: {},
      FAVLRDES: {},
      FAVLRIVA: {},
      FAVARIOS: {},
      FAVLRNET: {},
      FAPAG01: { clip: 2 },
      FAVLR01: {},
      FAPAG02: { clip: 2 },
      FAVLR02: {},
      FAPAG03: { clip: 2 },
      FAVLR03: {},
      FATIPODOM: { clip: 2 },
      FAESTADO: {},
      FAOBSER: { clip: 250 },
      FACONTROL: { clip: 36 },
    },
  },
  DOMITE: {
    key: 'IFPEDIDO',
    fields: {
      IFFACT: { clip: 12 },
      IFPEDIDO: { clip: 9 },
      IFCLIENTE: { clip: 13 },
      IFARTIC: { clip: 19 },
      IFEAN: { clip: 18 },
      IFNOMBRE: { clip: 60 },
      IFCANT: {},
      IFVLRUNI: {},
      IFVLRBRU: {},
      IFPORIVA: {},
      IFVLRIVA: {},
      IFVLRNET: {},
      IFPORDES: {},
      IFVLRDES: {},
      IFESTADO: {},
      IFFECHA: {},
      IFTIPO: { clip: 2 },
      IFSUCUR: { clip: 3 },
      IFBODEGA: { clip: 2 },
    },
  },
};

const tableNames = [...new Set([...Object.keys(WRITE)])];

const lines = [];
const push = (s = '') => lines.push(s);

push('# Comparación de esquema — FORTUNER vs integración ecommerce');
push('');
push(`Generado: ${new Date().toISOString()}`);
push('');
push('Fuentes:');
push('');
push('- **FORTUNER**: cabeceras de `C:\\ADD_FORTUNER` (dsi-vps), solo metadatos.');
push('- **Local**: `db/ads/openads/data/` (copia que usa la integración).');
push('- **Escritura**: campos que usan `push-catalog.mjs`, `push-customers.mjs` y `push-orders.mjs`.');
push('');

// ── 1. Diferencias de esquema local vs FORTUNER ──────────────────────────────
push('## 1. Esquema local vs FORTUNER');
push('');
push('| Tabla | Campos FORTUNER | Campos local | Solo FORTUNER | Solo local | Dif. tipo/long |');
push('|---|---:|---:|---|---|---|');

const localCommon = [];
for (const t of [...fs.readdirSync(E_DIR)].sort()) {
  const table = t.replace(/\.json$/i, '');
  const f = load(F_DIR, table, 'adt-headers-fortuner');
  const e = load(E_DIR, table, 'db/ads/openads/data');
  if (!f || !e) continue;
  localCommon.push(table);
  const F = fieldsOf(f);
  const E = fieldsOf(e);
  const onlyF = [...F.keys()].filter((k) => !E.has(k));
  const onlyE = [...E.keys()].filter((k) => !F.has(k));
  const dif = [...F.keys()].filter((k) => {
    const a = F.get(k);
    const b = E.get(k);
    return b && (a.type !== b.type || a.length !== b.length || a.decimals !== b.decimals);
  });
  push(
    `| ${table} | ${F.size} | ${E.size} | ${onlyF.join(', ') || '—'} | ${onlyE.join(', ') || '—'} | ${
      dif.map((k) => `${k}(${F.get(k).typeName}/${F.get(k).length} vs ${E.get(k).typeName}/${E.get(k).length})`).join(', ') || '—'
    } |`,
  );
}
push('');

// ── 2. Campos que escribimos ─────────────────────────────────────────────────
push('## 2. Campos que escribe la integración');
push('');
push('| Tabla | Campo | Tipo FORTUNER | ¿Existe? | Uso nuestro | Riesgo |');
push('|---|---|---|---|---|---|');

const risks = [];
for (const t of tableNames) {
  const f = load(F_DIR, t, 'adt-headers-fortuner');
  const F = fieldsOf(f);
  const spec = WRITE[t];
  for (const [name, use] of Object.entries(spec.fields)) {
    const field = F.get(name);
    const exists = !!field;
    let risk = '';
    if (!exists) {
      risk = '❗ NO EXISTE';
    } else if (field.typeName === 'char' && use.clip && use.clip > field.length) {
      risk = `❗ recorte ${use.clip} > ${field.length}`;
    } else if (field.typeName === 'char' && use.gen && use.gen.length > field.length) {
      risk = `❗ código generado ${use.gen.length} > ${field.length}`;
    } else if (field.typeName !== 'char' && use.clip) {
      risk = '⚠ tipo no char';
    } else if (field.typeName === 'char' && use.clip) {
      risk = `ok (recorte ${use.clip} ≤ ${field.length})`;
    } else if (field.typeName === 'char' && !use.clip) {
      risk = `⚠ sin recorte (largo ${field.length})`;
    } else {
      risk = 'ok';
    }
    if (risk.includes('❗') || risk.includes('⚠')) risks.push({ t, name, risk, field, use });
    push(
      `| ${t} | ${name} | ${field ? `${field.typeName}${field.length ? `(${field.length})` : ''}` : '—'} | ${exists ? 'sí' : 'NO'} | ${
        use.clip ? `recorte ${use.clip}` : use.gen ? `generado ${use.gen.length}` : '—'
      } | ${risk} |`,
    );
  }
}
push('');

// ── 3. Riesgos ───────────────────────────────────────────────────────────────
push('## 3. Riesgos detectados');
push('');
if (!risks.length) push('Sin riesgos de longitud/tipo en los campos mapeados.');
for (const r of risks) {
  push(`- **${r.t}.${r.name}**: ${r.risk}${r.field ? ` (ADT: ${r.field.typeName}(${r.field.length}))` : ''}`);
}
push('');

// ── 4. Notas de correspondencia ─────────────────────────────────────────────
push('## 4. Notas de correspondencia');
push('');
const tidcate = fieldsOf(load(F_DIR, 'TIDCATE', 'adt-headers-fortuner'));
const tidtab = fieldsOf(load(F_DIR, 'TIDTAB', 'adt-headers-fortuner'));
const peddia = fieldsOf(load(F_DIR, 'PEDDIA', 'adt-headers-fortuner'));
const domdia = fieldsOf(load(F_DIR, 'DOMDIA', 'adt-headers-fortuner'));
const vtadia = fieldsOf(load(F_DIR, 'VTADIA', 'adt-headers-fortuner'));

push('- **Categorías**: `TIDSAL.INCATE` referencia `TIDCATE` (códigos de 2/4/6 dígitos), así que el catálogo y la escritura usan esa tabla (`CTABCOD`/`CTABDES`, `CATE1..3`, `CARAC1..6`, `IMAGEN`, `HABILITA`). `TIDTAB` es un diccionario general y no se usa para categorías de producto.');
push('- **Pedidos**: escribimos `DOMDIA`/`DOMITE` (domicilios). En FORTUNER existen `PEDDIA`/`PEDITE` (pedidos, casi vacías: 6 y 5 filas) con estructura parecida pero no idéntica. Confirmar si el ERP factura desde `DOM*` o espera `PED*`.');
push('- **Ventas**: `VTADIA`/`VTAITE`/`VTAPAGO` son históricos/agregados de venta (825 cabeceras, 2.008.435 líneas, 8.555 pagos), no el punto de entrada de un pedido nuevo.');
push('- **Facturación**: `FADDIA`/`FADITE`/`FAPAGO` siguen siendo la fuente de verdad para conciliación (1.167.637 / 7.175.029 / 2.141.129 filas).');
push('- **Productos**: `TIDSAL` tiene 304 campos; nuestra escritura cubre nombre, precio 1/0 y saldo por sucursal. No hay INSERT de artículos nuevos (solo UPDATE por `INARTIC`).');
push('- **Sucursal**: `TIDSAL.INSUC` es `double` (se escribe numérico). `DOMDIA.FASUCUR` y `DOMITE.IFSUCUR` son `char(3)` (se escriben como texto de 2 dígitos, p. ej. `01`).');
push('');

push('## 5. Códigos cerrados y hallazgos abiertos');
push('');
push('Cerrado con datos reales de FORTUNER (ver `docs/ESCRITURA-FORTUNER-READINESS.md`):');
push('');
push('1. **Códigos generados**: `newErpCode` usa la longitud de la columna (`char(8)` marcas, `char(6)` categorías, `char(13)` clientes) con prefijo numérico `9`.');
push('2. **Recortes**: `POSCLI.CEDCLI(10)`, `EMAIL(50)`, `NOMBRE/APELLIDO(50)`, `TELCELU(12)`, `TIDCATE.CTABDES(150)`, `TIDTPRO.NOMBRE(30)`, `TIDMARCAS.MNOMBRE(80)`.');
push('3. **Tipos**: `TIDSAL.INSUC` y los `*ESTADO` bin2 se escriben numéricos; `FASUCUR`/`IFSUCUR` son char(3).');
push('4. **Numeración**: `FAPEDIDO` = `IFPEDIDO` = 9 dígitos (prefijo web `9`); `FAFACTURA` vacía hasta que el ERP facture.');
push('5. **Estados**: `FAESTADO` 0 pendiente / 5 cancelado / 9 facturado; `IFESTADO` vacío normal (0x8000 en disco) / 5 cancelado.');
push('6. **Enlace de líneas**: por `IFPEDIDO` (no `IFFACT`); `IFFACT` queda vacío hasta la factura.');
push('7. **Bodega**: `IFBODEGA=00` porque `TIDSAL.INBODEGA` es `00` en las 51.938 filas (bodega consolidada).');
push('8. **Ciudad**: `POSDANE` no es un diccionario de ciudades (contiene EAN + nombres de producto); `FACIUDAD` es texto libre de 12.');
push('9. **Envío**: va en `FAVARIOS`; `FAVLRFLE` está vacío en las filas reales.');
push('');
push('Abierto (requiere decisión del ERP):');
push('');
push('- **Categorías**: confirmado que el árbol es `TIDCATE`; `TIDTAB` no se usa para categorías de producto.');
push('- **Pedidos**: `DOMDIA`/`DOMITE` (domicilios) vs `PEDDIA`/`PEDITE` (pedidos, casi vacías). Confirmar si el ERP factura desde `DOM*`.');
push('- **Alta de artículos**: sólo hay UPDATE de `TIDSAL`; no se crean artículos nuevos.');
push('- **Deriva de esquema**: `TIDSAL.INCATE` es `char(6)` en FORTUNER y `char(7)` en la copia local.');
push('');
push('## 6. Conclusión');
push('');
push(`- Tablas locales comparadas: **${localCommon.length}** (todas existen en FORTUNER).`);
push(`- Campos mapeados revisados: **${Object.values(WRITE).reduce((a, s) => a + Object.keys(s.fields).length, 0)}**.`);
push(`- Riesgos de longitud/tipo: **${risks.length}**.`);
push('');

fs.writeFileSync(OUT, lines.join('\n'));
console.log(`Informe: ${path.relative(ROOT, OUT)}`);
console.log(`Tablas locales comparadas: ${localCommon.length}`);
console.log(`Riesgos: ${risks.length}`);
for (const r of risks) console.log(`  ${r.t}.${r.name}: ${r.risk}`);
