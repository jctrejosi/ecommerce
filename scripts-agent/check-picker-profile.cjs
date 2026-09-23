/**
 * Verificación del perfil del picker (app móvil):
 *   - POST /picking/profile/password   (exige la actual)
 *   - POST /picking/profile/avatar     (sube a Cloudinary y guarda la URL)
 * y de que esa foto es la misma que ve el panel: /auth/me y /picking-admin/users.
 *
 * Usa un usuario temporal (picker) que borra al final, incluso si algo falla.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/check-picker-profile.cjs
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const API = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

/** PNG 1x1 válido: el backend lo reescala a 512 para el avatar. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const QA = {
  username: 'qa-profile-check',
  email: 'qa-profile-check@local.test',
  password: 'qa-clave-1234',
};
const NUEVA = 'qa-clave-nueva-5678';

let failures = 0;
let checks = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const post = (path, body, token) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

const get = (path, token) =>
  fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function login(identifier, password) {
  const res = await post('/auth/login', { identifier, password });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  try {
    // ── Usuario temporal ──────────────────────────────────────────────────────
    await db.query('DELETE FROM users WHERE username = $1', [QA.username]);
    const qa = await db.query(
      `INSERT INTO users (email, username, password_hash, first_name, last_name,
                          is_superuser, is_active, is_picker)
       VALUES ($1, $2, $3, 'QA', 'Perfil', false, true, true)
       RETURNING id`,
      [QA.email, QA.username, await bcrypt.hash(QA.password, 10)],
    );
    const qaId = Number(qa.rows[0].id);
    console.log(`[setup] usuario temporal ${QA.username} (id ${qaId})`);

    const loginRes = await login(QA.username, QA.password);
    const token = loginRes.body?.accessToken;
    check('login del usuario temporal', loginRes.status === 200 && !!token);
    check(
      'el login ya devuelve avatarUrl (null al principio)',
      loginRes.body?.user && 'avatarUrl' in loginRes.body.user && loginRes.body.user.avatarUrl === null,
    );

    // ── Cambio de contraseña ──────────────────────────────────────────────────
    console.log('\n== Cambio de contraseña ==');
    const mala = await post(
      '/picking/profile/password',
      { currentPassword: 'no-es-la-mia', newPassword: NUEVA },
      token,
    );
    const malaBody = await mala.json().catch(() => null);
    check(`con la contraseña actual incorrecta -> ${mala.status}`, mala.status === 400, malaBody?.message);

    const corta = await post(
      '/picking/profile/password',
      { currentPassword: QA.password, newPassword: 'corta' },
      token,
    );
    check(`nueva contraseña demasiado corta -> ${corta.status}`, corta.status === 400);

    const sinToken = await post('/picking/profile/password', {
      currentPassword: QA.password,
      newPassword: NUEVA,
    });
    check(`sin sesión -> ${sinToken.status}`, sinToken.status === 401);

    const ok = await post(
      '/picking/profile/password',
      { currentPassword: QA.password, newPassword: NUEVA },
      token,
    );
    check(`cambio correcto -> ${ok.status}`, ok.status === 200);

    const row = (
      await db.query('SELECT password_hash FROM users WHERE id = $1', [qaId])
    ).rows[0];
    check('la BD guarda la contraseña nueva', bcrypt.compareSync(NUEVA, row.password_hash));
    check('la contraseña vieja ya no sirve', !bcrypt.compareSync(QA.password, row.password_hash));

    const reLogin = await login(QA.username, NUEVA);
    check(`login con la contraseña nueva -> ${reLogin.status}`, reLogin.status === 200);
    const token2 = reLogin.body?.accessToken;

    // ── Foto de perfil ────────────────────────────────────────────────────────
    console.log('\n== Foto de perfil ==');
    const form = new FormData();
    form.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'qa-avatar.png');
    const avatarRes = await fetch(`${API}/picking/profile/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token2}` },
      body: form,
    });
    const avatarBody = await avatarRes.json().catch(() => null);
    check(`subida -> ${avatarRes.status}`, avatarRes.status === 200 || avatarRes.status === 201, JSON.stringify(avatarBody)?.slice(0, 160));

    const saved = (
      await db.query('SELECT avatar_url FROM users WHERE id = $1', [qaId])
    ).rows[0]?.avatar_url;
    check('la URL quedó en users.avatar_url', !!saved && saved === avatarBody?.avatarUrl, saved ?? '(vacío)');

    if (saved) {
      const img = await fetch(saved);
      check(`la imagen responde y es una imagen -> ${img.status}`, img.ok && /image\//.test(img.headers.get('content-type') ?? ''), img.headers.get('content-type'));
    }

    // ── La misma foto en la app y en el panel ─────────────────────────────────
    console.log('\n== Misma foto en la app y en el panel ==');
    const me = await get('/auth/me', token2);
    const meBody = await me.json().catch(() => null);
    check('GET /auth/me devuelve avatarUrl', meBody?.avatarUrl === saved, String(meBody?.avatarUrl).slice(0, 60));

    // Token de admin para leer el listado del panel.
    const adminRow = (
      await db.query(`SELECT password_hash FROM users WHERE username = 'admin'`)
    ).rows[0];
    const adminPass = ['admdsi4231', 'admin123'].find((p) =>
      bcrypt.compareSync(p, adminRow?.password_hash ?? ''),
    );
    const adminLogin = await login('admin', adminPass);
    const adminToken = adminLogin.body?.accessToken;
    const users = await get('/picking-admin/users', adminToken);
    const list = await users.json().catch(() => null);
    const qaRow = Array.isArray(list) ? list.find((u) => u.id === qaId) : null;
    check(
      'el panel de picking admin ve la misma foto',
      !!qaRow && qaRow.avatarUrl === saved,
      qaRow ? String(qaRow.avatarUrl).slice(0, 60) : 'no aparece',
    );
    const pickers = await get('/picking-admin/pickers');
    const pickersList = await pickers.json().catch(() => null);
    const qaPicker = Array.isArray(pickersList) ? pickersList.find((p) => p.id === qaId) : null;
    check(
      'el endpoint de pickers (métricas del panel) también la trae',
      !!qaPicker && qaPicker.avatarUrl === saved,
      qaPicker ? String(qaPicker.avatarUrl).slice(0, 60) : 'no aparece',
    );
  } finally {
    const del = await db.query('DELETE FROM users WHERE username = $1', [QA.username]);
    console.log(`\n  limpieza: usuario temporal ${del.rowCount > 0 ? 'eliminado' : 'NO eliminado (revisar)'}`);
    await db.end();
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
