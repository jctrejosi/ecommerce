/**
 * Registra la app Android del picking (`com.dsi.pickingapp`) en el proyecto de
 * Firebase `ecommerce-dsi` y escribe su `google-services.json`.
 *
 * Por qué: `google-services.json` es por paquete, y el que existe es el del
 * cliente (`com.dsi.mercaldasclient`). El SDK de Firebase falla al inicializar si
 * no hay una entrada para el applicationId de la app, así que el picking necesita
 * la suya. Se usa la misma cuenta de servicio que ya tiene el backend.
 *
 * No imprime secretos: solo un resumen (paquete, appId, proyecto).
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/setup-picking-firebase.cjs
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(
  resolve(__dirname, '../backend/package.json'),
);
const jwt = requireFromBackend('jsonwebtoken');

const PACKAGE_NAME = 'com.dsi.pickingapp';
const DISPLAY_NAME = 'DSI Picking';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://firebase.googleapis.com/v1beta1';
const OUT = resolve(__dirname, '../Interface movil picking/google-services.json');

async function main() {
  const env = readFileSync(
    resolve(__dirname, '../backend/.env.development.local'),
    'utf8',
  );
  const raw = env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=(.*)$/m)?.[1]?.trim();
  if (!raw) throw new Error('falta FIREBASE_SERVICE_ACCOUNT_JSON en el .env');
  const sa = JSON.parse(
    raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'),
  );
  sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  const projectId = sa.project_id;

  const assertion = jwt.sign(
    { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL },
    sa.private_key,
    { algorithm: 'RS256', expiresIn: '1h' },
  );
  const tokRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) throw new Error(`token: ${JSON.stringify(tok)}`);
  const auth = { Authorization: `Bearer ${tok.access_token}` };

  console.log(`proyecto: ${projectId}`);

  // 1) ¿Ya está registrada la app?
  const listRes = await fetch(`${API}/projects/${projectId}/androidApps`, {
    headers: auth,
  });
  const list = await listRes.json();
  if (!listRes.ok) {
    throw new Error(
      `listar apps falló (${listRes.status}): ${JSON.stringify(list)}`,
    );
  }
  let app = (list.apps ?? []).find(
    (a) => a.packageName === PACKAGE_NAME,
  );

  // 2) Si no, se crea (operación asíncrona).
  if (!app) {
    console.log(`registrando ${PACKAGE_NAME}…`);
    const createRes = await fetch(`${API}/projects/${projectId}/androidApps`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageName: PACKAGE_NAME,
        displayName: DISPLAY_NAME,
      }),
    });
    let op = await createRes.json();
    if (!createRes.ok) {
      throw new Error(
        `crear app falló (${createRes.status}): ${JSON.stringify(op)}`,
      );
    }
    // 3) Esperar a que la operación termine.
    for (let i = 0; i < 30 && !op.done; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const opRes = await fetch(`${API}/${op.name}`, { headers: auth });
      op = await opRes.json();
    }
    if (!op.done) throw new Error('la creación no terminó a tiempo');
    app = op.response;
  }
  if (!app?.appId) throw new Error(`sin appId: ${JSON.stringify(app)}`);
  console.log(`app: ${app.packageName} (${app.appId})`);

  // 4) Descargar el contenido de google-services.json (viene en base64).
  const cfgRes = await fetch(
    `${API}/projects/${projectId}/androidApps/${app.appId}/config`,
    { headers: auth },
  );
  const cfg = await cfgRes.json();
  if (!cfgRes.ok || !cfg.configFileContents) {
    throw new Error(
      `config falló (${cfgRes.status}): ${JSON.stringify(cfg)}`,
    );
  }
  const contents = Buffer.from(cfg.configFileContents, 'base64').toString(
    'utf8',
  );
  const parsed = JSON.parse(contents);
  writeFileSync(OUT, contents + '\n');

  const clients = (parsed.client ?? []).map((c) => c.client_info?.android_client_info?.package_name);
  console.log(`escrito: Interface movil picking/google-services.json`);
  console.log(`paquetes en el archivo: ${clients.join(', ')}`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
