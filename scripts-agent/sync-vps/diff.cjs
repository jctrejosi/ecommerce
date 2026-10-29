#!/usr/bin/env node
// Compara los CSV local vs servidor y emite SOLO un resumen (conteos + muestra corta).
const fs = require('fs');
const path = require('path');

const dir = (lado) => path.join(__dirname, 'data', lado);

function parse(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split('\n').filter((l) => l.length);
  const header = lines.shift().split(',');
  return lines.map((l) => {
    // CSV generado por COPY csv: no hay comas embebidas en las columnas elegidas
    // salvo `name`/`path`; se usa un parser simple con comillas.
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) {
        if (c === '"') {
          if (l[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    const o = {};
    header.forEach((h, i) => (o[h] = out[i]));
    return o;
  });
}

const load = (n, lado = 'local') => parse(path.join(dir(lado), n + '.csv'));

function cmp(nombre, filaLocal, filaServidor, key, campos) {
  const s = new Map(filaServidor.map((r) => [key(r), r]));
  const l = new Map(filaLocal.map((r) => [key(r), r]));
  const soloLocal = [...l.keys()].filter((k) => !s.has(k));
  const soloServidor = [...s.keys()].filter((k) => !l.has(k));
  const distintos = [];
  for (const [k, rl] of l) {
    const rs = s.get(k);
    if (!rs) continue;
    const dif = campos.filter((c) => (rl[c] ?? '') !== (rs[c] ?? ''));
    if (dif.length) distintos.push({ k, dif, local: dif.map((c) => `${c}=${rl[c]}`).join(' '), servidor: dif.map((c) => `${c}=${rs[c]}`).join(' ') });
  }
  console.log(`\n=== ${nombre} ===`);
  console.log(`  local=${l.size} servidor=${s.size} | solo-local=${soloLocal.length} solo-servidor=${soloServidor.length} distintos=${distintos.length}`);
  if (soloLocal.length) console.log(`  solo-local (muestra): ${soloLocal.slice(0, 5).join(', ')}`);
  if (soloServidor.length) console.log(`  solo-servidor (muestra): ${soloServidor.slice(0, 5).join(', ')}`);
  for (const d of distintos.slice(0, 6)) console.log(`  #${d.k}: local[${d.local}] servidor[${d.servidor}]`);
  return { soloLocal, soloServidor, distintos };
}

// categories
const cat = cmp('categories', load('categories'), load('categories', 'server'), (r) => r.id,
  ['parent_id', 'name', 'slug', 'code', 'level', 'display_order', 'image_media_id', 'is_active', 'deleted_at']);

// products: solo el estado
const prodL = load('products');
const prodS = load('products', 'server');
const act = cmp('products (estado)', prodL, prodS, (r) => r.id, ['is_active', 'visibility', 'is_public', 'deleted_at']);

// product_categories
cmp('product_categories', load('product_categories'), load('product_categories', 'server'),
  (r) => `${r.product_id}:${r.category_id}`, []);

// media
const med = cmp('media', load('media'), load('media', 'server'), (r) => r.id, ['path', 'checksum', 'mime_type', 'size_bytes']);

// product_images
cmp('product_images', load('product_images'), load('product_images', 'server'), (r) => r.id,
  ['product_id', 'media_id', 'is_cover', 'position']);

// settings
const setL = load('settings');
const setS = load('settings', 'server');
console.log(`\n=== settings.landing_categories ===`);
console.log(`  local: ${setL.length ? setL[0].value : '(sin fila)'}`);
console.log(`  servidor: ${setS.length ? setS[0].value : '(sin fila)'}`);

// Resumen clave
console.log('\n=== RESUMEN ===');
console.log(`categorías nuevas a insertar: ${cat.soloLocal.length}`);
console.log(`categorías a actualizar: ${cat.distintos.length}`);
console.log(`productos a cambiar de estado: ${act.distintos.length}`);
console.log(`pares product_categories nuevos: ver arriba`);
console.log(`media nuevas a insertar: ${med.soloLocal.length}`);
