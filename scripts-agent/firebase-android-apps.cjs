/**
 * Firebase Management API: lista (y opcionalmente registra) las apps Android del
 * proyecto, usando la cuenta de servicio que ya tiene el backend.
 *
 * SOLO LECTURA por defecto:
 *   NODE_PATH=backend/node_modules node scripts-agent/firebase-android-apps.cjs
 * Registra la app de delivery si falta y baja su google-services.json:
 *   NODE_PATH=backend/node_modules node scripts-agent/firebase-android-apps.cjs --register
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'backend', '.env.development.local');
const PROJECT_ID = 'ecommerce-dsi';
const PACKAGE_NAME = 'com.dsi.deliveryapp';
const REGISTER = process.argv.includes('--register');

/** Lee FIREBASE_SERVICE_ACCOUNT_JSON del .env (JSON o base64). No lo imprime. */
function loadServiceAccount() {
  const line = fs
    .readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith('FIREBASE_SERVICE_ACCOUNT_JSON='));
  if (!line) throw new Error('no encontré FIREBASE_SERVICE_ACCOUNT_JSON en el .env');
  let raw = line.slice(line.indexOf('=') + 1).trim();
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const acc = JSON.parse(json);
  acc.private_key = acc.private_key.replace(/\\n/g, '\n');
  return acc;
}

async function accessToken(acc, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: acc.client_email, scope: scopes, aud: 'https://oauth2.googleapis.com/token' },
    acc.private_key,
    { algorithm: 'RS256', expiresIn: '1h' },
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`token: ${data.error_description ?? data.error ?? res.status}`);
  }
  return data.access_token;
}

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no JSON */
  }
  return { ok: res.ok, status: res.status, data: parsed, raw: text };
}

async function main() {
  const acc = loadServiceAccount();
  console.log(`cuenta de servicio: ${acc.client_email.split('@')[0].slice(0, 6)}…@…`);
  console.log(`proyecto: ${PROJECT_ID}`);

  const token = await accessToken(acc, 'https://www.googleapis.com/auth/cloud-platform');
  console.log('access token obtenido ✓');

  const list = await api(
    token,
    'GET',
    `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/androidApps`,
  );
  if (!list.ok) {
    console.log(`listar apps falló (${list.status}): ${list.data?.error?.message ?? list.raw.slice(0, 200)}`);
    return;
  }
  const apps = list.data?.apps ?? [];
  console.log(`apps Android registradas: ${apps.length}`);
  for (const a of apps) {
    console.log(`  · ${a.packageName}  (${a.appId})`);
  }
  const exists = apps.some((a) => a.packageName === PACKAGE_NAME);
  console.log(`${PACKAGE_NAME} registrada: ${exists ? 'SÍ' : 'NO'}`);

  if (!REGISTER) {
    if (!exists) console.log('\n(ejecuta con --register para registrarla y bajar su google-services.json)');
    return;
  }

  if (!exists) {
    console.log(`\nregistrando ${PACKAGE_NAME}…`);
    const created = await api(
      token,
      'POST',
      `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/androidApps`,
      { packageName: PACKAGE_NAME, displayName: 'Delivery DSI' },
    );
    if (!created.ok && created.status !== 409) {
      const msg = created.data?.error?.message ?? created.raw.slice(0, 300);
      console.log(`falló (${created.status}): ${msg}`);
      return;
    }

    // El POST devuelve una operación asíncrona: se espera a que termine.
    const opName = created.data?.name;
    if (opName?.startsWith('operations/')) {
      for (let i = 0; i < 20; i++) {
        const op = await api(token, 'GET', `https://firebase.googleapis.com/v1beta1/${opName}`);
        if (op.data?.done) {
          if (op.data?.error) {
            console.log(`operación falló: ${op.data.error.message}`);
            return;
          }
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  // Se relee la lista: es la fuente de verdad del appId.
  const after = await api(
    token,
    'GET',
    `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/androidApps`,
  );
  const app = (after.data?.apps ?? []).find((a) => a.packageName === PACKAGE_NAME);
  if (!app) {
    console.log('no encontré la app en el listado del proyecto');
    return;
  }
  console.log(`app: ${app.packageName} (${app.appId})`);

  const cfg = await api(
    token,
    'GET',
    `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/androidApps/${app.appId}/config`,
  );
  if (!cfg.ok) {
    console.log(`descargar config falló (${cfg.status}): ${cfg.data?.error?.message ?? cfg.raw.slice(0, 300)}`);
    return;
  }
  const json = Buffer.from(cfg.data.configFileContents, 'base64').toString('utf8');
  const out = path.join(ROOT, 'Interface movil delivery', 'google-services.json');
  fs.writeFileSync(out, json);
  console.log(`guardado: ${path.relative(ROOT, out)}`);
  const parsed = JSON.parse(json);
  for (const c of parsed.client ?? []) {
    console.log(`  · ${c.client_info.android_client_info.package_name}`);
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
