/**
 * Diccionario de datos de la base REAL del ERP (`C:\ADD_FORTUNER\PUBLIDATA.add`)
 * leido por SQL contra el servicio Advantage (asqlcmd). No usa copias locales.
 *
 *   node scripts-agent/erp/dict-fortuner-ads.mjs
 *
 * Salida en `db/add_fortuner_study/`:
 *   README.md
 *   catalogo-tablas.json
 *   <TABLA>-diccionario-datos.json   (una por tabla del ERP)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log } from './lib.mjs';
import { createAsqlcmdClient } from './asqlcmd.mjs';
import { TABLAS, LECTURA, significadoDe, tipoLegible } from './fortuner-meanings.mjs';
import { metaTabla, renderReadme } from './fortuner-tablas.mjs';

const SRC_TIDSAL = path.join(ROOT, 'docs/TIDSAL-significados.json');
const OUT = path.join(ROOT, 'db/add_fortuner_study');
const GENERADO = new Date().toISOString().slice(0, 10);

// Conteos: solo tablas pequenas/medianas. Las gigantes (FADITE 5,7 GB, FADCLI,
// FADCON, VIS*) se dejan en null para no escanearlas.
const CONTAR = new Set(
  [
    'TIDSAL', 'TIDCATE', 'TIDMARCAS', 'TIDTPRO', 'TIDTAB', 'TIDBODE', 'TIDTIPOS',
    'TIDSUCUR', 'TIDLISTA', 'TIDPRECI', 'TIDEAN', 'TIDMES', 'TIDCOMPR', 'TIDCON',
    'TIDDIA', 'TIDGON', 'TIDOBSER', 'TIDORDEN', 'TIDORDM', 'TIDPRENW',
    'POSPAGO', 'POSDANE', 'POSCLI', 'POSCAJA', 'POSACTIV', 'POSALTER', 'POSANIV',
    'POSARDC2', 'POSARDCT', 'POSCAMBIO', 'POSCONSE', 'POSCOPAG', 'POSDCTOS',
    'POSDCTO2', 'POSDCTO3', 'POSDCTO5', 'POSMENU', 'POSPAGO2', 'POSPOPER', 'POSPRUTA',
    'DOMDIA', 'DOMITE', 'PEDDIA', 'PEDITE', 'PEDITERE',
    'VTADIA', 'VTAITE', 'VTAPAGO', 'PAGO01', 'COTDIA', 'COTITE',
    'FADDIA', 'FADEVIDE', 'FADISPO', 'FADLINEA', 'FADVISIT', 'FAPAGO',
    'RUTAENC', 'RUTAITEM', 'NOMCALEN', 'USUSUCUR', 'CADEMP', 'ENCUENC', 'ENCUITE',
    'CONPUC', 'CONIVA', 'CONRET', 'CONREITE', 'CONTERCE', 'CONLOTES',
    'MOV00', 'mov01',
  ].map((x) => x.toUpperCase()),
);

const erp = createAsqlcmdClient({ mode: 'asqlcmd', timeout: 300000 });
const countClient = createAsqlcmdClient({ mode: 'asqlcmd', timeout: 25000 });

log('⏳ Leyendo catálogo del ERP…');
const tablesRes = erp.sql(
  'SELECT Name, Table_Primary_Key FROM system.tables ORDER BY Name',
  500,
);
const tables = tablesRes.rows.map((r) => ({
  name: r[0],
  pk: (r[1] || '').trim() || null,
}));
log(`   ${tables.length} tablas`);

log('⏳ Leyendo columnas de todas las tablas…');
const colsRes = erp.sql(
  'SELECT Parent, Name, Field_Num, Field_Type, Field_Length, Field_Decimal, Field_Can_Be_Null FROM system.columns ORDER BY Parent, Field_Num',
  20000,
);
const byTable = new Map();
for (const r of colsRes.rows) {
  const [parent, name, num, type, length, dec, nullable] = r;
  if (!parent || !name) continue;
  if (!byTable.has(parent)) byTable.set(parent, []);
  byTable.get(parent).push({
    name,
    num: Number(num),
    type: Number(type),
    length: Number(length),
    decimals: Number(dec) || 0,
    nullable: (nullable || '').toUpperCase() === 'T',
  });
}
log(`   ${colsRes.rows.length} columnas`);

// Significados de TIDSAL (diccionario ya acordado con el negocio).
let tidsalMeanings = {};
if (fs.existsSync(SRC_TIDSAL)) {
  tidsalMeanings = JSON.parse(fs.readFileSync(SRC_TIDSAL, 'utf8'));
}

fs.mkdirSync(OUT, { recursive: true });
// Limpia salidas previas para no dejar tablas viejas.
for (const f of fs.readdirSync(OUT)) {
  if (f.endsWith('-diccionario-datos.json')) fs.unlinkSync(path.join(OUT, f));
}

function significado(tabla, columna) {
  return significadoDe(tabla, columna, tidsalMeanings);
}

const resumen = [];
let totalCampos = 0;
let totalAlta = 0;
let totalMedia = 0;
let totalBaja = 0;

for (const t of tables) {
  const cols = byTable.get(t.name) ?? [];
  const up = t.name.toUpperCase();
  const meta = TABLAS[up] ?? {};
  const metaTablaInfo = metaTabla(up);

  const columnas = cols.map((c, idx) => {
    const [significadoCol, confianza] = significado(t.name, c.name);
    return {
      idx,
      columna: c.name,
      tipo: tipoLegible(c.type),
      bytes: c.length,
      decimales: c.decimals,
      offset: null,
      nullable: c.nullable,
      significado: significadoCol,
      confianza,
    };
  });

  for (const c of columnas) {
    totalCampos++;
    if (c.confianza === 'alta') totalAlta++;
    else if (c.confianza === 'media') totalMedia++;
    else totalBaja++;
  }

  let registros = null;
  if (CONTAR.has(up)) {
    try {
      const r = countClient.sql(`SELECT COUNT(*) AS N FROM ${t.name}`, 1);
      registros = Number(r.rows[0]?.[0]) || 0;
    } catch {
      registros = null;
    }
  }

  const doc = {
    tabla: t.name,
    nombre_completo: metaTablaInfo?.nombre_completo ?? 'Sin nombre completo catalogado',
    sistema: 'FORTUNER / Advantage (ERP TID)',
    archivo_fuente: `C:\\ADD_FORTUNER\\PUBLIDATA.add\\${t.name}.adt`,
    descripcion:
      metaTablaInfo?.descripcion ??
      meta.descripcion ??
      'Tabla del ERP; el proposito no esta confirmado en esta revision.',
    registros,
    clave_primaria: t.pk,
    total_columnas: columnas.length,
    generado: GENERADO,
    nota:
      "Diccionario generado desde la base real del ERP. Los significados son APROXIMADOS; " +
      "'confianza' (alta/media/baja) indica su fiabilidad y deben corregirse con el diccionario del sistema TID.",
    convenciones: meta.convenciones ?? {},
    relaciones: meta.relaciones ?? [],
    tipos_de_dato: LECTURA,
    columnas,
  };

  fs.writeFileSync(
    path.join(OUT, `${t.name}-diccionario-datos.json`),
    JSON.stringify(doc, null, 2) + '\n',
  );

  resumen.push({
    tabla: t.name,
    nombre_completo: doc.nombre_completo,
    registros,
    columnas: columnas.length,
    pk: t.pk,
    alta: columnas.filter((c) => c.confianza === 'alta').length,
    media: columnas.filter((c) => c.confianza === 'media').length,
    baja: columnas.filter((c) => c.confianza === 'baja').length,
    descripcion: doc.descripcion,
  });
}

fs.writeFileSync(
  path.join(OUT, 'catalogo-tablas.json'),
  JSON.stringify(
    {
      sistema: 'FORTUNER / Advantage (ERP TID)',
      base: 'C:\\ADD_FORTUNER\\PUBLIDATA.add',
      generado: GENERADO,
      total_tablas: resumen.length,
      total_columnas: totalCampos,
      tablas: resumen,
    },
    null,
    2,
  ) + '\n',
);

// ── README ──
fs.writeFileSync(
  path.join(OUT, 'README.md'),
  renderReadme({ resumen, totalCampos, totalAlta, totalMedia, totalBaja, generado: GENERADO }),
);

log(`✅ ${resumen.length} tablas | ${totalCampos} columnas (${totalAlta} alta, ${totalMedia} media, ${totalBaja} baja)`);
log(`   salida: ${OUT}`);
