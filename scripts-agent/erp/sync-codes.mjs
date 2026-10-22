/**
 * Puebla `erp_code_map` con los códigos reales de FORTUNER.
 *
 * Fuente principal: las tablas-diccionario copiadas de `C:\ADD_FORTUNER` a
 * `db/ads/fortuner-dicts` (POSPAGO, TIDTIPOS, TIDBODE, TIDMARCAS, TIDTPRO).
 * No requiere OpenADS corriendo. Si un archivo no está, ese dominio se deja
 * intacto y se avisa.
 *
 * Códigos cerrados con datos reales (ver docs/ESCRITURA-FORTUNER-READINESS.md):
 *   - payment_method : códigos POSPAGO + mapeo de los enums del ecommerce.
 *   - tax            : sólo TIDTIPOS.CLASE='IM'; `TIPO` es el código de la tasa
 *                      y `VALOR` el porcentaje. DOMITE usa IFPORIVA, no IFTIMP.
 *   - warehouse      : TIDBODE completo (TIDSAL usa INBODEGA='00').
 *   - brand          : TIDMARCAS.
 *   - product_type   : TIDTPRO.
 *   - order_status   : 0 pendiente / 5 cancelado / 9 facturado-entregado.
 *   - city           : SIN FUENTE. `POSDANE` no contiene ciudades (guarda EAN y
 *                      nombres de producto) y `DOMDIA.FACIUDAD` es texto libre
 *                      de 12 caracteres. Se elimina el dominio corrupto.
 *
 * Uso: node scripts-agent/erp/sync-codes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPg } from './openads.mjs';
import { readAdt } from './adt.mjs';
import { ROOT, s, log } from './lib.mjs';

const DIR = process.env.ERP_ADT_DIR || path.join(ROOT, 'db/ads/fortuner-dicts');
const pg = createPg();

/** Mapeo ecommerce payment_method_enum → POSPAGO.CODIGO. */
const PAY_MAP = {
  CASH: 'EF', // EFECTIVO
  CARD: 'TC', // TARJETA CREDITO (el ecommerce no distingue débito)
  PSE: 'TF', // TRANSFERENCIA BANCARIA
  BANK_TRANSFER: 'TF',
  NEQUI: 'TF',
  DAVIPLATA: 'TF',
  BREB: 'TF',
};

/** Estado del ecommerce → DOMDIA.FAESTADO (bin2). */
const ORDER_STATUS = {
  created: '0',
  payment_pending: '0',
  paid: '0',
  preparing: '0',
  ready: '0',
  shipped: '0',
  delivered: '9',
  cancelled: '5',
  refunded: '5',
};

/** Tarifa (%) → TIDTIPOS.TIPO preferido dentro de CLASE='IM'. */
const TAX_BY_RATE = {
  0: 'E', // EXCLUIDO (TIDSAL usa E para el 0 %)
  5: 'C',
  8: 'P', // IMP CONSUMO 8 %
  10: 'S',
  16: 'I',
  19: 'J',
  20: 'V', // IVA 20 % genérico (U es "Productos Ultraprocesados")
  35: 'T',
};

const dictPath = (name) => path.join(DIR, name);
const hasDict = (name) => fs.existsSync(dictPath(name));

function readDict(name, fields) {
  if (!hasDict(name)) {
    log(`  ! falta ${path.relative(ROOT, dictPath(name))}: dominio sin cambios`);
    return null;
  }
  return readAdt(dictPath(name), fields).rows;
}

function add(map, erpValue, canonical, label, meta = {}) {
  const code = s(erpValue);
  const key = s(canonical);
  if (!code || !key) return;
  map.set(`${code}\u0000${key}`, {
    erpValue: code,
    canonical: key,
    label: s(label) || code,
    meta,
  });
}

function entriesForPayment(rows) {
  const out = new Map();
  if (!rows) return [];
  const byCode = new Map();
  for (const r of rows) {
    const code = s(r.CODIGO);
    if (!code) continue;
    const cur = byCode.get(code) || {
      name: s(r.NOMBRE) || code,
      validWeb: false,
      permidsi: false,
      sucursales: new Set(),
    };
    cur.validWeb ||= r.VALIDAWEB === true;
    cur.permidsi ||= r.PERMIDSI === true;
    cur.sucursales.add(s(r.SUCUR) || '—');
    byCode.set(code, cur);
  }
  for (const [code, v] of byCode) {
    add(out, code, code, v.name, {
      valid_web: v.validWeb,
      permidsi: v.permidsi,
      sucursales: [...v.sucursales],
    });
  }
  for (const [canonical, code] of Object.entries(PAY_MAP)) {
    const v = byCode.get(code);
    if (!v) {
      log(`  ! payment_method: POSPAGO no tiene ${code} (${canonical})`);
      continue;
    }
    add(out, code, canonical, v.name, { mapping: true });
  }
  return [...out.values()];
}

function entriesForTax(rows) {
  const out = new Map();
  if (!rows) return [];
  const rateOf = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && Math.abs(x) > 1e-300 ? x : 0;
  };
  const im = rows.filter((r) => s(r.CLASE) === 'IM');
  for (const r of im) {
    add(out, r.TIPO, r.TIPO, r.NOMBRE, {
      clase: 'IM',
      rate: rateOf(r.VALOR),
      valor3: rateOf(r.VALOR2),
      flag: s(r.FLAG) || null,
    });
  }
  // Una fila por tarifa, con el código preferido (el resto queda en el meta).
  const byRate = new Map();
  for (const r of im) {
    const rate = rateOf(r.VALOR);
    if (!byRate.has(rate)) byRate.set(rate, []);
    byRate.get(rate).push(r);
  }
  for (const [rate, list] of byRate) {
    const pref = TAX_BY_RATE[rate];
    const chosen = list.find((r) => s(r.TIPO) === pref) || list[0];
    add(out, chosen.TIPO, String(rate), chosen.NOMBRE, {
      rate,
      mapping: true,
      alternatives: list.map((r) => ({ tipo: s(r.TIPO), nombre: s(r.NOMBRE) })),
    });
  }
  return [...out.values()];
}

function entriesForWarehouse(rows) {
  const out = new Map();
  for (const r of rows || []) add(out, r.CODIGO, r.CODIGO, r.NOMBRE);
  return [...out.values()];
}

function entriesForBrand(rows) {
  const out = new Map();
  for (const r of rows || []) add(out, r.MCODIGO, r.MCODIGO, r.MNOMBRE);
  return [...out.values()];
}

function entriesForProductType(rows) {
  const out = new Map();
  for (const r of rows || []) {
    add(out, r.CODIGO, r.CODIGO, r.NOMBRE, {
      habilita: r.HABILITA === true,
      oculta: r.OCULTA === true,
    });
  }
  return [...out.values()];
}

function entriesForOrderStatus() {
  const out = new Map();
  const labels = {
    '0': 'Pendiente en ERP',
    '5': 'Cancelado',
    '9': 'Facturado / entregado',
  };
  for (const [canonical, code] of Object.entries(ORDER_STATUS)) {
    add(out, code, canonical, labels[code] || code, { mapping: true });
  }
  return [...out.values()];
}

async function replaceDomain(domain, entries) {
  await pg.query('BEGIN');
  try {
    await pg.query('DELETE FROM erp_code_map WHERE domain=$1', [domain]);
    const CHUNK = 1000;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const params = [domain];
      const values = chunk.map((e, j) => {
        const b = 1 + j * 4;
        params.push(e.erpValue, e.canonical, e.label, JSON.stringify(e.meta || {}));
        return `($1, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb)`;
      });
      await pg.query(
        `INSERT INTO erp_code_map (domain, erp_value, canonical, label, meta)
         VALUES ${values.join(',')}`,
        params,
      );
    }
    await pg.query('COMMIT');
  } catch (e) {
    await pg.query('ROLLBACK');
    throw e;
  }
  log(`  ${domain.padEnd(16)} ${String(entries.length).padStart(5)} filas`);
}

await pg.connect();
try {
  log(`Diccionarios FORTUNER: ${path.relative(ROOT, DIR)}`);
  const pospago = readDict('POSPAGO.ADT', ['CODIGO', 'NOMBRE', 'SUCUR', 'PERMIDSI', 'VALIDAWEB']);
  const tidtipos = readDict('TIDTIPOS.ADT', ['CLASE', 'TIPO', 'NOMBRE', 'VALOR', 'VALOR2', 'FLAG']);
  const tidbode = readDict('TIDBODE.adt', ['CODIGO', 'NOMBRE']);
  const tidmarcas = readDict('TIDMARCAS.adt', ['MCODIGO', 'MNOMBRE']);
  const tidtpro = readDict('TIDTPRO.ADT', ['CODIGO', 'NOMBRE', 'HABILITA', 'OCULTA']);

  const domains = [
    ...(pospago ? [['payment_method', entriesForPayment(pospago)]] : []),
    ...(tidtipos ? [['tax', entriesForTax(tidtipos)]] : []),
    ...(tidbode ? [['warehouse', entriesForWarehouse(tidbode)]] : []),
    ...(tidmarcas ? [['brand', entriesForBrand(tidmarcas)]] : []),
    ...(tidtpro ? [['product_type', entriesForProductType(tidtpro)]] : []),
    ['order_status', entriesForOrderStatus()],
    // Sin fuente fiable: FACIUDAD es texto libre y POSDANE no es un diccionario
    // de ciudades. Se limpia la semilla corrupta anterior.
    ['city', []],
  ];

  for (const [domain, entries] of domains) await replaceDomain(domain, entries);

  const t = await pg.query(
    'SELECT domain, count(*) n FROM erp_code_map GROUP BY 1 ORDER BY 2 DESC',
  );
  log('\nerp_code_map:');
  for (const r of t.rows) log(`  ${r.domain.padEnd(16)} ${r.n}`);
} finally {
  await pg.end();
}
