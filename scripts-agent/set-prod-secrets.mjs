#!/usr/bin/env node
/**
 * Rellena los secretos de DESPLIEGUE que el proyecto puede generar solo, en
 * `docker/.env` (el que usa `docker/compose` y el contenedor único):
 *
 *   - JWT_SECRET      → aleatorio de 64 hex si está vacío/placeholder o es débil.
 *   - ADMIN_PASSWORD   → aleatorio si no hay ADMIN_PASSWORD ni ADMIN_PASSWORD_HASH
 *                        (el entrypoint es fail-closed: sin ella NO arranca).
 *
 * NO toca los secretos de servicios externos (CLOUDINARY_*, DEEPSEEK_API_KEY,
 * WOMPI_*, EPAYCO_*, RESEND_API_KEY…): esos los rellena el operador.
 *
 * Uso (desde la raíz del repo):
 *   node scripts-agent/set-prod-secrets.mjs
 *
 * Es idempotente: si ya hay un valor válido, lo conserva. Solo imprime el
 * ADMIN_PASSWORD generado (el operador lo necesita para el Basic Auth); nunca
 * imprime los valores existentes.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ENV_PATH = path.resolve("docker/.env");
if (!fs.existsSync(ENV_PATH)) {
  console.error(`✘ No existe ${ENV_PATH} — créalo antes:  cp docker/.env.example docker/.env`);
  process.exit(1);
}

let txt = fs.readFileSync(ENV_PATH, "utf8");

const PLACEHOLDER =
  /^(|change-?me|cambia(-esto)?|tu[_-]|your[_-]|example|placeholder|xxx+|secreto?|secret|test|demo|admin|password|<.*>)$/i;
const cur = (k) => (txt.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim() ?? "";
const isWeak = (v) => PLACEHOLDER.test(v) || (v.length > 0 && v.length < 32);

function setKey(key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  txt = re.test(txt) ? txt.replace(re, `${key}=${value}`) : txt.trimEnd() + `\n${key}=${value}\n`;
}

const results = [];

// ── JWT_SECRET ──────────────────────────────────────────────
const jwtNow = cur("JWT_SECRET");
if (isWeak(jwtNow)) {
  setKey("JWT_SECRET", crypto.randomBytes(32).toString("hex"));
  results.push(`  JWT_SECRET      : generado (64 hex)`);
} else {
  results.push(`  JWT_SECRET      : se conserva el existente (${jwtNow.length} chars)`);
}

// ── ADMIN_PASSWORD (Basic Auth de paneles y /bot) ───────────
const hasHash = !PLACEHOLDER.test(cur("ADMIN_PASSWORD_HASH"));
const hasPwd = !PLACEHOLDER.test(cur("ADMIN_PASSWORD"));
let generated = "";
if (hasHash) {
  results.push(`  ADMIN_PASSWORD  : se usa ADMIN_PASSWORD_HASH existente (no se toca)`);
} else if (hasPwd) {
  results.push(`  ADMIN_PASSWORD  : se conserva el existente`);
} else {
  generated = crypto.randomBytes(12).toString("base64url");
  setKey("ADMIN_PASSWORD", generated);
  results.push(`  ADMIN_PASSWORD  : generado`);
}

fs.writeFileSync(ENV_PATH, txt);

console.log(`✔ docker/.env actualizado:`);
for (const r of results) console.log(r);
if (generated) {
  console.log(`\n  🔑 Credenciales del Basic Auth (paneles admin y /bot):`);
  console.log(`       Usuario    : admin`);
  console.log(`       Contraseña : ${generated}`);
  console.log(`     (guárdala; si la cambias, edita ADMIN_PASSWORD y reinicia el contenedor)`);
}
console.log(
  `\n  ⚠️  Pendiente de rellenar a mano (servicios externos): ` +
    `CLOUDINARY_*, DEEPSEEK_API_KEY, WOMPI_*/EPAYCO_* y RESEND_API_KEY si los usas.`,
);
