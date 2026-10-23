/**
 * Reaplica los metadatos curados a los diccionarios ya generados en
 * `db/add_fortuner_study/`, sin volver a leer la base Advantage (no necesita el
 * servidor):
 *
 *   - `nombre_completo` y `descripcion` de cada tabla (`fortuner-tablas.mjs`).
 *   - significado y confianza de cada columna (`fortuner-meanings.mjs`).
 *
 *   node scripts-agent/erp/patch-table-metadata.mjs
 *
 * Reescribe cada `<TABLA>-diccionario-datos.json`, `catalogo-tablas.json` y el
 * `README.md`. Es idempotente. Los tipos, longitudes y nulos NO se tocan: esos
 * sólo los refresca `dict-fortuner-ads.mjs` contra el servidor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log } from './lib.mjs';
import { TABLAS_META, metaTabla, renderReadme } from './fortuner-tablas.mjs';
import { significadoDe } from './fortuner-meanings.mjs';

const OUT = path.join(ROOT, 'db/add_fortuner_study');
const CATALOGO = path.join(OUT, 'catalogo-tablas.json');
const SRC_TIDSAL = path.join(ROOT, 'docs/TIDSAL-significados.json');
const GENERICO = /el proposito no esta confirmado/i;

const tidsalMeanings = fs.existsSync(SRC_TIDSAL)
  ? JSON.parse(fs.readFileSync(SRC_TIDSAL, 'utf8'))
  : {};

const catalogo = JSON.parse(fs.readFileSync(CATALOGO, 'utf8'));
const sinMeta = [];
let actualizadas = 0;
let camposRevisados = 0;
let camposCambiados = 0;
let totalCampos = 0;
let totalAlta = 0;
let totalMedia = 0;
let totalBaja = 0;

const resumen = catalogo.tablas.map((t) => {
  const meta = metaTabla(t.tabla);
  if (!meta) sinMeta.push(t.tabla);

  const nombre_completo = meta?.nombre_completo ?? 'Sin nombre completo catalogado';
  const descripcion = meta?.descripcion ?? t.descripcion;

  let columnas = null;
  const file = path.join(OUT, `${t.tabla}-diccionario-datos.json`);
  if (fs.existsSync(file)) {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));

    columnas = doc.columnas.map((c) => {
      const [significado, confianza] = significadoDe(t.tabla, c.columna, tidsalMeanings);
      camposRevisados++;
      if (significado !== c.significado || confianza !== c.confianza) camposCambiados++;
      return { ...c, significado, confianza };
    });

    const out = {};
    for (const [k, v] of Object.entries(doc)) {
      if (k === 'tabla') {
        out.tabla = v;
        out.nombre_completo = nombre_completo;
      } else if (k === 'nombre_completo') {
        // ya escrito arriba; no copiar el valor viejo del archivo
        continue;
      } else if (k === 'descripcion') {
        out.descripcion = descripcion;
      } else if (k === 'columnas') {
        out.columnas = columnas;
      } else {
        out[k] = v;
      }
    }
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    actualizadas++;
  }

  const cuenta = (conf) => (columnas ?? []).filter((c) => c.confianza === conf).length;
  const alta = columnas ? cuenta('alta') : t.alta;
  const media = columnas ? cuenta('media') : t.media;
  const baja = columnas ? cuenta('baja') : t.baja;

  totalCampos += t.columnas;
  totalAlta += alta;
  totalMedia += media;
  totalBaja += baja;

  return {
    tabla: t.tabla,
    nombre_completo,
    registros: t.registros,
    columnas: t.columnas,
    pk: t.pk,
    alta,
    media,
    baja,
    descripcion,
  };
});

const generado = catalogo.generado ?? new Date().toISOString().slice(0, 10);
fs.writeFileSync(
  CATALOGO,
  JSON.stringify({ ...catalogo, tablas: resumen }, null, 2) + '\n',
);

fs.writeFileSync(
  path.join(OUT, 'README.md'),
  renderReadme({ resumen, totalCampos, totalAlta, totalMedia, totalBaja, generado }),
);

const faltantes = resumen.filter((r) => GENERICO.test(r.descripcion)).map((r) => r.tabla);
const metaSinTabla = Object.keys(TABLAS_META).filter(
  (k) => !resumen.some((r) => r.tabla.toUpperCase() === k.toUpperCase()),
);

log(`✅ ${actualizadas} diccionarios | ${resumen.length} tablas | ${totalCampos} columnas`);
log(`   ${totalAlta} alta, ${totalMedia} media, ${totalBaja} baja | ${camposCambiados} significados actualizados de ${camposRevisados}`);
log(`   ${metaSinTabla.length ? `metadatos sin tabla: ${metaSinTabla.join(', ')}` : 'todos los metadatos tienen tabla'}`);
log(`   ${sinMeta.length ? `tablas sin metadatos: ${sinMeta.join(', ')}` : 'todas las tablas tienen nombre y descripcion'}`);
log(`   ${faltantes.length ? `descripciones genericas: ${faltantes.join(', ')}` : 'sin descripciones genericas'}`);
