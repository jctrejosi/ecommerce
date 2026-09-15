/**
 * Reproduce el escaneo de subred que hace el APK cliente
 * (`Interface movil client/src/server.ts` → `scanSubnet`).
 *
 * Objetivo: ver si un barrido concurrente de 192.168.0.1..254 con timeout corto
 * encuentra al servidor real. Sirve para diagnosticar por qué el APK no lo ve.
 *
 * Uso: node scripts-agent/test-scan-subnet.mjs [prefijo] [puerto] [batch] [timeoutMs]
 */
const PREFIX = process.argv[2] || "192.168.0.";
const PORT = process.argv[3] || "4173";
const BATCH = Number(process.argv[4] || 40);
const TIMEOUT = Number(process.argv[5] || 600);
const SERVICE_ID = "mercaldas-webclient";

/** Prueba GET /discovery en una URL. */
async function ping(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${url}/discovery`, { signal: controller.signal });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, reason: `http ${res.status}` };
    const data = await res.json().catch(() => null);
    return { ok: data?.service === SERVICE_ID, ms, reason: data?.service || "sin service" };
  } catch (e) {
    const cause = e?.cause?.code || e?.cause?.message || e?.message;
    return { ok: false, ms: Date.now() - started, reason: `${e.name}: ${cause}` };
  } finally {
    clearTimeout(timer);
  }
}

const hosts = Array.from({ length: 254 }, (_, i) => i + 1);
let found = null;
const t0 = Date.now();

for (let i = 0; i < hosts.length; i += BATCH) {
  const batch = hosts.slice(i, i + BATCH);
  const batchNo = i / BATCH + 1;
  const startedBatch = Date.now();
  const results = await Promise.all(
    batch.map(async (host) => {
      const url = `http://${PREFIX}${host}:${PORT}`;
      const r = await ping(url, TIMEOUT);
      return { host, url, ...r };
    }),
  );
  const batchMs = Date.now() - startedBatch;
  const hit = results.find((r) => r.ok);
  const target = results.find((r) => r.host === 132);
  console.log(
    `lote ${batchNo}: ${batch[0]}..${batch[batch.length - 1]} en ${batchMs} ms` +
      (target ? ` | .132=${target.ok ? "OK" : target.reason}/${target.ms}ms` : "") +
      (hit ? ` | ENCONTRADO ${hit.url} (${hit.ms} ms)` : ""),
  );
  if (hit && !found) {
    found = hit.url;
    break;
  }
}

console.log(
  found
    ? `\nResultado: ${found} tras ${Date.now() - t0} ms`
    : `\nResultado: no encontrado tras ${Date.now() - t0} ms`,
);
