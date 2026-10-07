/**
 * Descarga los glifos (fuentes) de OpenFreeMap usados por los estilos del mapa
 * del panel delivery-admin, para empaquetarlos en `public/map/fonts` y no
 * depender de la red al pintar las etiquetas.
 *
 * Uso: node scripts-agent/download-map-glyphs.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://tiles.openfreemap.org/fonts';
const OUT = path.join(
  __dirname,
  '..',
  'Interface web delivery admin',
  'public',
  'map',
  'fonts',
);
const FONTSTACKS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];

async function bajar(fontstack, start) {
  const end = start + 255;
  const file = `${start}-${end}.pbf`;
  const url = `${BASE}/${encodeURIComponent(fontstack)}/${file}`;
  for (let intento = 1; intento <= 4; intento++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return 0;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 4) throw new Error('respuesta vacía');
      const dir = path.join(OUT, fontstack);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), buf);
      return buf.length;
    } catch (err) {
      if (intento === 4) {
        console.warn(`  ⚠ ${fontstack} ${file}: ${err.message}`);
        return 0;
      }
      await new Promise((r) => setTimeout(r, 400 * intento));
    }
  }
  return 0;
}

async function main() {
  // Rangos útiles para textos en español/Latín + puntuación + símbolos.
  // El resto (CJK, cirílico, etc.) no aparece en Manizales: si MapLibre los
  // pidiera, dará 404 local instantáneo (sin salir a la red).
  const starts = [0, 256, 512, 768, 1024, 1280, 1536, 1792, 8192, 8448, 9216, 9728, 9984];

  let total = 0;
  let files = 0;
  for (const fontstack of FONTSTACKS) {
    let fontBytes = 0;
    let fontFiles = 0;
    const CONC = 16;
    for (let i = 0; i < starts.length; i += CONC) {
      const lote = starts.slice(i, i + CONC);
      const res = await Promise.all(lote.map((s) => bajar(fontstack, s)));
      for (const n of res) {
        if (n > 0) {
          fontBytes += n;
          fontFiles += 1;
        }
      }
    }
    total += fontBytes;
    files += fontFiles;
    console.log(`${fontstack}: ${fontFiles} rangos, ${(fontBytes / 1024).toFixed(0)} KB`);
  }
  console.log(`TOTAL: ${files} archivos, ${(total / 1024 / 1024).toFixed(2)} MB`);

  // Verificación: todas las fuentes deben tener EXACTAMENTE el mismo conjunto
  // de rangos (si a una le falta el rango 0-255, MapLibre recibe HTML y rompe).
  const leer = (f) => {
    const dir = path.join(OUT, f);
    return new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  };
  const porFuente = FONTSTACKS.map((f) => [f, leer(f)]);
  const union = new Set();
  for (const [, set] of porFuente) for (const x of set) union.add(x);
  const faltan = [];
  for (const [f, set] of porFuente) {
    for (const file of union) if (!set.has(file)) faltan.push(`${f} → ${file}`);
  }
  if (faltan.length) {
    console.warn(`⚠ Faltan ${faltan.length} archivos:\n   ${faltan.join('\n   ')}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ Las ${FONTSTACKS.length} fuentes tienen el mismo conjunto de ${union.size} rangos`);
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
