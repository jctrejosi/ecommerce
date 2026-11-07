/**
 * Cliente SQL para el Advantage Database Server (ADS) real de Windows.
 *
 * Usa `asqlcmd64.exe` (viene con Advantage 12) contra el servicio ADS, sin abrir
 * los .adt directamente. Así el ERP y el ecommerce pueden leer/escribir a la vez
 * sin riesgo de dos motores sobre los mismos archivos.
 *
 * Configuración por entorno:
 *   ERP_ADS_MODE=asqlcmd
 *   ADS_CMD=C:\Program Files\Advantage 12.0\Server\asqlcmd64.exe
 *   ADS_SERVER=TCP:127.0.0.1:6262
 *   ADS_DATABASE=C:\ADD_FORTUNER\PUBLIDATA.add
 *   ADS_USER=ADSSYS
 *   ADS_PASS=
 */
import { spawnSync } from 'node:child_process';
import { TextDecoder } from 'node:util';

const DEFAULT_CMD = 'C:\\Program Files\\Advantage 12.0\\Server\\asqlcmd64.exe';

// asqlcmd64.exe es un binario ANSI (codepage Windows-1252). Node lo decodificaba
// como UTF-8 y los caracteres acentuados (p. ej. 'ñ' = 0xD1) se corrompían a
// U+FFFD '�'. Decodificamos en Windows-1252 para preservar tildes y eñes.
const ANSI = new TextDecoder('windows-1252');

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`valor numérico inválido: ${value}`);
    return String(value);
  }
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `'${y}${m}${d}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Añade TOP / START AT a un SELECT (paginación nativa de Advantage). */
function windowed(sql, limit, offset) {
  // Si la consulta ya trae TOP, no se añade otro; sólo se desplaza si hace falta.
  if (/^\s*SELECT\s+(DISTINCT\s+)?TOP\s+\d+/i.test(sql)) {
    return offset > 0
      ? sql.replace(/(^\s*SELECT\s+(?:DISTINCT\s+)?TOP\s+\d+\s+)/i, `$1START AT ${offset + 1} `)
      : sql;
  }
  if (!Number.isFinite(limit) || limit <= 0) return sql;
  const m = sql.match(/^(\s*SELECT\s+)(DISTINCT\s+)?/i);
  if (!m) return sql;
  const distinct = m[2] ? 'DISTINCT ' : '';
  const start = offset > 0 ? `START AT ${offset + 1} ` : '';
  return `${m[1]}TOP ${limit} ${start}${distinct}${sql.slice(m[0].length)}`;
}

/**
 * Parsea la salida CSV de asqlcmd. La primera fila es la cabecera y la última
 * línea de control ("Finished. Lines processed = N") se descarta.
 *
 * asqlcmd encierra entre comillas los campos con comas/saltos de línea pero NO
 * escapa las comillas internas (`HUESO 5"`, `"NSA...`). Por eso un campo
 * citado se cierra en la primera comilla seguida de coma, salto de línea o EOF;
 * una comilla al inicio seguida de texto se trata como literal.
 */
export function parseAsqlcmd(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;

  const flushRow = () => {
    row.push(field);
    field = '';
    const values = row;
    row = [];
    if (!values.length) return;
    if (values.length === 1) {
      const only = values[0];
      if (/^\s*Finished\./.test(only) || /^\s*Number of rows affected:/.test(only) || /^\s*Done\.?\s*$/.test(only)) return;
    }
    if (values.some((v) => v !== '')) rows.push(values);
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' && field === '') {
      // Busca el cierre real del campo citado.
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '"') {
          const next = text[j + 1];
          if (next === undefined || next === ',' || next === '\r' || next === '\n') break;
        }
        j++;
      }
      if (j < text.length) {
        field = text.slice(i + 1, j);
        i = j + 1;
        continue;
      }
      // Sin cierre: es una comilla literal, no un delimitador.
      field += '"';
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      flushRow();
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length) flushRow();

  if (!rows.length) return { cols: [], rows: [] };
  const [cols, ...data] = rows;
  return { cols, rows: data.filter((r) => r.length === cols.length) };
}

export function createAsqlcmdClient(cfg = {}) {
  const cmd = cfg.cmd || process.env.ADS_CMD || DEFAULT_CMD;
  const server = cfg.server || process.env.ADS_SERVER || 'TCP:127.0.0.1:6262';
  const database = cfg.database || process.env.ADS_DATABASE || 'C:\\ADD_FORTUNER\\PUBLIDATA.add';
  const user = cfg.user || process.env.ADS_USER || 'ADSSYS';
  const pass = cfg.pass ?? process.env.ADS_PASS ?? '';

  function run(query) {
    const args = [
      '-S', server,
      '-CS', `Data Source=${database}`,
      '-U', user,
      '-P', pass,
      '-Q', query,
    ];
    const r = spawnSync(cmd, args, {
      encoding: 'buffer',
      windowsHide: true,
      timeout: cfg.timeout ?? 180000,
      maxBuffer: 512 * 1024 * 1024,
    });
    if (r.error) throw new Error(`ADS ${cmd}: ${r.error.message}`);
    const out = ANSI.decode(Buffer.concat([r.stdout || Buffer.alloc(0), r.stderr || Buffer.alloc(0)]));
    if (r.status !== 0 || /^\s*Error:/m.test(out) || /Error \d+:/m.test(out)) {
      throw new Error(`ADS SQL falló (exit ${r.status}): ${out.trim().slice(0, 1500)}`);
    }
    const affected = Number((out.match(/Number of rows affected:\s*(\d+)/i) || [])[1] || 0);
    return { ...parseAsqlcmd(out), affected };
  }

  return {
    config: { cmd, server, database, user, engine: 'asqlcmd' },
    health: () => {
      run('SELECT 1 AS OK');
      return { status: 'ok', engine: 'asqlcmd' };
    },
    schema: (table) =>
      run(`SELECT Name, Field_Type, Field_Length FROM system.columns WHERE Parent = ${literal(table)}`),
    rows: (table, { offset = 0, limit = 100 } = {}) =>
      run(windowed(`SELECT * FROM ${table}`, limit, offset)),
    sql: (sql, opts = 200) => {
      const o = typeof opts === 'number' ? { limit: opts } : opts || {};
      return run(windowed(sql, o.limit ?? Infinity, o.offset ?? 0));
    },
    insert: (table, values) => {
      const cols = Object.keys(values);
      if (!cols.length) throw new Error(`insert ${table}: sin columnas`);
      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => literal(values[c])).join(', ')})`;
      run(sql);
      return { ok: true };
    },
    update: (table, recno, values) => {
      const sets = Object.keys(values).map((c) => `${c} = ${literal(values[c])}`).join(', ');
      run(`UPDATE ${table} SET ${sets} WHERE recno = ${Number(recno)}`);
      return { ok: true };
    },
    remove: (table, recno) => {
      run(`DELETE FROM ${table} WHERE recno = ${Number(recno)}`);
      return { ok: true };
    },
  };
}
