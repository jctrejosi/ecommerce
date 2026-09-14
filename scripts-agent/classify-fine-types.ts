/**
 * Genera un mapeo tipo-fino (CATEGORIA del origen) -> tipo amplio del admin.
 *
 * Clasifica en LOTES PEQUEÑOS (evita respuestas truncadas y contextos enormes):
 * una petición a DeepSeek por cada grupo de N tipos finos.
 *
 * Salida: scripts-agent/fine-to-broad.json  ({ "042": "DESPENSA", ... })
 * No escribe en la BD.
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const load = (f: string) => JSON.parse(readFileSync(path.join(BACKEND, 'data/JSON', f), 'latin1'));
const trim = (v: unknown) => String(v ?? '').trim();

function loadEnv(file: string) {
  const out: Record<string, string> = { ...process.env } as any;
  try {
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}
const env = loadEnv(path.join(ROOT, 'bot', '.env'));
const API_KEY = env.DEEPSEEK_API_KEY;
const MODEL = env.DEEPSEEK_MODEL || 'deepseek-chat';
const API_URL = env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
if (!API_KEY) {
  console.error('Falta DEEPSEEK_API_KEY en bot/.env');
  process.exit(1);
}

const BROAD: Record<string, string> = {
  CARNES: 'Carnes, pollo, pescado, embutidos y delicatessen',
  BEBE: 'Cuidado del bebé (pañales, fórmulas, teteros, cuidado infantil)',
  CUIDADO: 'Cuidado personal, higiene, cosméticos, droguería/farmacia (medicamentos, vitaminas, botiquín, dermatológicos, afeitado, cuidado bucal, talcos, desodorantes)',
  DESPENSA: 'Despensa y abarrotes (enlatados, granos, pastas, aceites, salsas, café, galletas, dulces, panadería, repostería, snacks, condimentos)',
  ELECTRO: 'Electrodomésticos (lavadoras, neveras, licuadoras, estufas, ventiladores, planchas)',
  FRUTAS: 'Frutas y verduras frescas y congeladas',
  HOGAR: 'Hogar (menaje, ollas, sartenes, utensilios, vajilla, organizadores, textiles de hogar)',
  LACTEOS: 'Lácteos y refrigerados (leche, quesos, yogures, cremas de leche, mantequillas, huevos, helados, refrigerados)',
  LIMPIEZA: 'Limpieza del hogar (detergentes, blanqueadores, jabones de ropa, limpiadores, papel higiénico)',
  MASCOTAS: 'Mascotas (alimento y accesorios para perros/gatos)',
  TECNO: 'Tecnología y electrónica (celulares, audífonos, computo, accesorios tecnológicos)',
  VINOS: 'Vinos y licores (cervezas, aguardientes, whiskies)',
  OTROS: 'Solo si no encaja en NINGUNA otra (servicios, artículos no de supermercado). Evítalo: la mayoría de alimentos van a DESPENSA y la droguería a CUIDADO',
};

const SISTEMA =
  `Clasificas tipos de producto de un supermercado en categorías amplias.\n` +
  `Categorías válidas (usa EXACTAMENTE el código):\n` +
  Object.entries(BROAD).map(([k, v]) => `- ${k}: ${v}`).join('\n') +
  `\n\nResponde ÚNICAMENTE con el JSON solicitado, sin explicaciones ni texto adicional.`;

async function clasificarLote(pares: [string, string][]): Promise<Record<string, string>> {
  const lista = pares.map(([code, name]) => `${code} = ${name}`).join('\n');
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SISTEMA },
      { role: 'user', content: `Devuelve un objeto JSON que mapee cada código a UNA categoría amplia:\n\n${lista}` },
    ],
    temperature: 0.1,
    max_tokens: 6000,
  };
  const resp = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data: any = await resp.json();
  const choice = data.choices?.[0] ?? {};
  const content: string = choice.message?.content ?? '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end < 0) {
    throw new Error(`Respuesta sin JSON (finish=${choice.finish_reason}, len=${content.length})`);
  }
  return JSON.parse(content.slice(start, end + 1));
}

async function main() {
  const catalog = load('CATALOGO.JSON').PRODUCTOS as any[];
  const tipoName = new Map<string, string>();
  for (const t of load('TIPOS_PRODUCTOS.JSON').TIPOS_PRODUCTOS) tipoName.set(trim(t.CODIGO), trim(t.NOMBRE));

  const counts = new Map<string, number>();
  for (const p of catalog) {
    const c = trim(p.CATEGORIA);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const BATCH = 30;
  const mapping: Record<string, string> = {};
  for (let i = 0; i < items.length; i += BATCH) {
    const lote = items.slice(i, i + BATCH);
    const pares: [string, string][] = lote.map(([c]) => [c, tipoName.get(c) ?? '(sin nombre)']);
    let res: Record<string, string> = {};
    for (let intento = 1; intento <= 2; intento++) {
      try {
        res = await clasificarLote(pares);
        break;
      } catch (e) {
        if (intento === 2) console.error(`  lote ${i / BATCH + 1} falló: ${(e as Error).message}`);
      }
    }
    for (const [c] of lote) {
      const v = typeof res[c] === 'string' ? res[c].trim().toUpperCase() : '';
      mapping[c] = v && BROAD[v] ? v : 'OTROS';
    }
    console.log(`  lote ${i / BATCH + 1}/${Math.ceil(items.length / BATCH)} ok (${lote.length})`);
  }

  writeFileSync(path.join(__dirname, 'fine-to-broad.json'), JSON.stringify(mapping, null, 2));

  const broadCount = new Map<string, number>();
  const broadTypes = new Map<string, number>();
  for (const [code, n] of items) {
    const b = mapping[code];
    broadCount.set(b, (broadCount.get(b) ?? 0) + n);
    broadTypes.set(b, (broadTypes.get(b) ?? 0) + 1);
  }
  console.log(`\nGuardado fine-to-broad.json (${Object.keys(mapping).length} tipos)`);
  for (const [b, n] of [...broadCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${b}: ${n} productos (${broadTypes.get(b)} tipos finos)`);
  }
  const otros = items.filter(([c]) => mapping[c] === 'OTROS');
  if (otros.length) console.log('OTROS:', otros.map(([c, n]) => `${c}:${tipoName.get(c) ?? '?'}(${n})`).join(', ').slice(0, 700));
}

void main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
