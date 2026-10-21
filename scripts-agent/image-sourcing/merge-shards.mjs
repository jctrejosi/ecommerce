#!/usr/bin/env node
/**
 * Fusiona los manifests de los shards (`db/image-sourcing/shards/*`/) con el
 * manifest principal y regenera `summary.json`.
 *
 * Se queda con la última lectura por producto (`checked_at` más reciente).
 *
 * Uso:
 *   node scripts-agent/image-sourcing/merge-shards.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, 'db', 'image-sourcing');
const MAIN = path.join(BASE, 'candidates.ndjson');
const SUMMARY = path.join(BASE, 'summary.json');
const SHARDS_DIR = path.join(BASE, 'shards');

function readFile(file, into) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (r?.product_id == null) continue;
      const prev = into.get(r.product_id);
      const ta = Date.parse(r.checked_at || 0) || 0;
      const tb = Date.parse(prev?.checked_at || 0) || 0;
      if (!prev || ta >= tb) into.set(r.product_id, r);
    } catch {
      /* línea parcial */
    }
  }
}

const byProduct = new Map();
readFile(MAIN, byProduct);

let shardFiles = 0;
if (fs.existsSync(SHARDS_DIR)) {
  for (const d of fs.readdirSync(SHARDS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(SHARDS_DIR, d.name, 'candidates.ndjson');
    if (fs.existsSync(f)) {
      readFile(f, byProduct);
      shardFiles++;
    }
  }
}

const records = [...byProduct.values()].sort((a, b) => Number(a.product_id) - Number(b.product_id));
fs.writeFileSync(MAIN, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

const byStatus = {};
const byProvider = {};
const byConfidence = { '0.9-1.0': 0, '0.7-0.9': 0, '0.45-0.7': 0, '0-0.45': 0 };
const noneReason = { con_barcode: 0, sin_barcode: 0 };
let productsWithCandidate = 0;
for (const r of records) {
  byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  if (r.status === 'candidate') {
    productsWithCandidate++;
    byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
    if (r.confidence >= 0.9) byConfidence['0.9-1.0']++;
    else if (r.confidence >= 0.7) byConfidence['0.7-0.9']++;
    else if (r.confidence >= 0.45) byConfidence['0.45-0.7']++;
    else byConfidence['0-0.45']++;
  }
  if (r.status === 'none') {
    noneReason[r.code_kind === 'barcode' ? 'con_barcode' : 'sin_barcode']++;
  }
}

const summary = {
  generated_at: new Date().toISOString(),
  merged_from: { main: path.relative(ROOT, MAIN), shards: shardFiles },
  totals: {
    products_tracked: records.length,
    with_candidate: productsWithCandidate,
    by_status: byStatus,
    candidates_by_provider: byProvider,
    candidates_by_confidence: byConfidence,
    none_reason: noneReason,
  },
};
fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 2) + '\n');

console.log(`Shards fusionados: ${shardFiles}`);
console.log(`Productos en manifest: ${records.length}`);
console.log(`Estado: ${JSON.stringify(byStatus)}`);
console.log(`Con candidato: ${productsWithCandidate}`);
