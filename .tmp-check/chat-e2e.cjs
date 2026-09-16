/*
 * Prueba end-to-end del chat picker ↔ administrador.
 *   - Firma tokens de prueba (picker = juan, admin = admin) con el secreto local.
 *   - Verifica REST: hilo, resumen (no leídos) y bandeja.
 *   - Verifica el tiempo real: el picker y la sala `staff` reciben `picking:chat`.
 *   - Borra los mensajes de prueba al terminar.
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const { Client } = require('pg');

const ROOT = '/home/jk/Proyectos/dsi/ecommerce';
const BASE = 'http://localhost:3000';
const PICKER_ID = 19; // juan
const ADMIN_ID = 1; // admin

const env = fs.readFileSync(path.join(ROOT, 'backend/.env.development.local'), 'utf8');
const JWT_SECRET = /^JWT_SECRET=(.*)$/m.exec(env)[1].trim();

const token = (sub, isSuperuser, username) =>
  jwt.sign({ sub, email: `${username}@test.local`, username, isSuperuser }, JWT_SECRET, {
    expiresIn: '1h',
  });

const pickerToken = token(PICKER_ID, false, 'juan');
const adminToken = token(ADMIN_ID, true, 'admin');

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${label}${extra ? ' -> ' + extra : ''}`);
  if (!ok) failures++;
};

async function api(method, url, tok, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no JSON */
  }
  return { status: res.status, json };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = new Client('postgresql://postgres:postgres@localhost:5432/ecommerce');
  await db.connect();

  // Partimos de un hilo limpio para que los conteos sean deterministas.
  await db.query('delete from picker_chat_messages where picker_id = $1', [PICKER_ID]);

  // ── Sockets ────────────────────────────────────────────────────────────────
  const pickerSock = io(`${BASE}/picking-events`, {
    transports: ['websocket'],
    auth: { token: pickerToken },
  });
  const staffSock = io(`${BASE}/picking-events`, {
    transports: ['websocket'],
    auth: {},
  });
  const pickerEvents = [];
  const staffEvents = [];
  pickerSock.on('picking:chat', (p) => pickerEvents.push(p));
  staffSock.on('picking:chat', (p) => staffEvents.push(p));
  staffSock.on('connect', () => staffSock.emit('subscribe:staff'));

  await Promise.all([
    new Promise((r) => pickerSock.on('connect', r)),
    new Promise((r) => staffSock.on('connect', r)),
  ]);
  await wait(400); // deja que el backend registre las salas

  // ── Seguridad ──────────────────────────────────────────────────────────────
  const anon = await api('GET', '/picking/chat');
  check('GET /picking/chat sin token responde 401', anon.status === 401, `status=${anon.status}`);
  const anonAdmin = await api('GET', '/picking-admin/chats');
  check('GET /picking-admin/chats sin token responde 401', anonAdmin.status === 401, `status=${anonAdmin.status}`);
  const notSuper = await api('GET', '/picking-admin/chats', pickerToken);
  check('GET /picking-admin/chats con token de picker responde 403', notSuper.status === 403, `status=${notSuper.status}`);

  // ── Flujo del picker ───────────────────────────────────────────────────────
  const empty = await api('GET', '/picking/chat', pickerToken);
  check('hilo inicial vacío', Array.isArray(empty.json) && empty.json.length === 0, JSON.stringify(empty.json));

  const sent = await api('POST', '/picking/chat', pickerToken, { body: 'Hola, ¿me ayudas con una ubicación?' });
  check('el picker envía (201)', sent.status === 201, `status=${sent.status}`);
  check('el mensaje guarda senderType=picker', sent.json?.senderType === 'picker', JSON.stringify(sent.json));

  const vacio = await api('POST', '/picking/chat', pickerToken, { body: '   ' });
  check('mensaje vacío rechazado (400)', vacio.status === 400, `status=${vacio.status}`);

  // ── Bandeja del admin ──────────────────────────────────────────────────────
  const inbox1 = await api('GET', '/picking-admin/chats', adminToken);
  const juanRow = (inbox1.json ?? []).find((c) => c.pickerId === PICKER_ID);
  check('la bandeja incluye a juan', Boolean(juanRow), JSON.stringify(juanRow));
  check('bandeja marca 1 no leído', juanRow?.unread === 1, `unread=${juanRow?.unread}`);
  check('bandeja trae el último mensaje', juanRow?.lastMessage?.body?.startsWith('Hola'), JSON.stringify(juanRow?.lastMessage));

  // ── Respuesta del admin ────────────────────────────────────────────────────
  const reply = await api('POST', `/picking-admin/pickers/${PICKER_ID}/messages`, adminToken, {
    body: 'Claro, está en la estantería A3.',
  });
  check('el admin responde (201)', reply.status === 201, `status=${reply.status}`);
  check('la respuesta guarda senderType=admin', reply.json?.senderType === 'admin', JSON.stringify(reply.json));

  await wait(600);
  check('el picker recibe el evento en vivo', pickerEvents.length >= 1, `eventos=${pickerEvents.length}`);
  check(
    'el evento llega con pickerId correcto',
    pickerEvents[pickerEvents.length - 1]?.pickerId === PICKER_ID,
    JSON.stringify(pickerEvents[pickerEvents.length - 1]?.pickerId),
  );
  check('la sala staff recibe ambos sentidos', staffEvents.length >= 2, `eventos=${staffEvents.length}`);

  // ── Lectura ────────────────────────────────────────────────────────────────
  const summaryBefore = await api('GET', '/picking/chat/summary', pickerToken);
  check(
    'el picker tenía 1 sin leer del admin',
    summaryBefore.json?.unread === 1,
    JSON.stringify(summaryBefore.json?.unread),
  );

  const thread = await api('GET', '/picking/chat', pickerToken);
  check('el hilo trae 2 mensajes y marca leído', thread.json?.length === 2, `mensajes=${thread.json?.length}`);
  check(
    'el mensaje del admin queda como leído',
    thread.json?.[1]?.readAt != null,
    JSON.stringify(thread.json?.[1]?.readAt),
  );

  const summaryAfter = await api('GET', '/picking/chat/summary', pickerToken);
  check('el resumen queda en 0', summaryAfter.json?.unread === 0, `unread=${summaryAfter.json?.unread}`);

  const inbox2 = await api('GET', '/picking-admin/chats', adminToken);
  const juanRow2 = (inbox2.json ?? []).find((c) => c.pickerId === PICKER_ID);
  check('la bandeja del admin sigue con 1 sin leer (no abrió el hilo)', juanRow2?.unread === 1, `unread=${juanRow2?.unread}`);

  const adminThread = await api('GET', `/picking-admin/pickers/${PICKER_ID}/messages`, adminToken);
  check('el admin ve el hilo completo', adminThread.json?.length === 2, `mensajes=${adminThread.json?.length}`);
  check(
    'al abrir el hilo, el mensaje del picker queda leído',
    adminThread.json?.[0]?.readAt != null,
    JSON.stringify(adminThread.json?.[0]?.readAt),
  );

  const inbox3 = await api('GET', '/picking-admin/chats', adminToken);
  const juanRow3 = (inbox3.json ?? []).find((c) => c.pickerId === PICKER_ID);
  check('la bandeja del admin queda en 0 tras abrir el hilo', juanRow3?.unread === 0, `unread=${juanRow3?.unread}`);

  // ── Limpieza ───────────────────────────────────────────────────────────────
  const del = await db.query('delete from picker_chat_messages where picker_id = $1', [PICKER_ID]);
  console.log(`\nlimpieza: ${del.rowCount} mensaje(s) de prueba borrados`);

  pickerSock.disconnect();
  staffSock.disconnect();
  await db.end();

  console.log(failures === 0 ? '\nTODO OK' : `\n${failures} comprobación(es) fallaron`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
