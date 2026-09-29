#!/usr/bin/env node
/**
 * seed-sample-campaigns.mjs
 *
 * Crea 4 campañas de ejemplo (con producto real con imagen) para poblar el
 * listado de campañas de la Interface web analytics (que estaba casi vacío).
 *
 * - Crea vía POST /admin/campaigns (name + productId(s) + channels + messages).
 * - Ajusta estado (PUT /admin/campaigns/:id) para mostrar variedad de badges.
 * - Rellena audiencia/métricas (audience_count, sent_count, opened_count,
 *   converted_count) por SQL para que las tarjetas no salgan todas en 0.
 *
 * Uso:  node seed-sample-campaigns.mjs
 * Salida: sólo un resumen (id, nombre, estado). No volcar JSON completo.
 */
import { execSync } from "node:child_process";

const API = process.env.API_URL ?? "http://localhost:3000";

const CAMPAIGNS = [
  {
    name: "Café de la mañana — Colcafé 170g",
    productIds: [120346],
    mode: "multi",
    tone: "cercano",
    prompt: "Promoción de café Colcafé para la rutina de la mañana",
    channels: ["whatsapp", "email"],
    priorityChannel: "whatsapp",
    status: "programada",
    scheduledAt: plusDays(2),
    messages: [
      {
        channel: "whatsapp",
        content:
          "¡Hola {{nombre}}! ☕ Empieza el día con el mejor aroma de casa: Café Colcafé Bastiya 170g a $21.400. Pide el tuyo y te lo llevamos. 🛒",
      },
      {
        channel: "email",
        subject: "Tu Café Colcafé 170g te está esperando ☕",
        content:
          "¡Hola {{nombre}}! Sabemos que un buen café cambia la mañana. Te dejamos el Café Colcafé Bastiya 170g a $21.400. Aprovecha antes de que se acabe.",
      },
    ],
    metrics: { audience: 3240, sent: 0, opened: 0, converted: 0 },
  },
  {
    name: "Desayuno saludable — Avena Quaker",
    productIds: [120451],
    mode: "multi",
    tone: "inspirador",
    prompt: "Avena Quaker manzana y canela para desayunos saludables",
    channels: ["whatsapp", "sms"],
    priorityChannel: "sms",
    status: "enviada",
    scheduledAt: plusDays(-3),
    sentAt: plusDays(-3),
    messages: [
      {
        channel: "whatsapp",
        content:
          "{{nombre}}, un desayuno completo empieza con Avena Quaker Manzana-Canel 300g por $9.700. ¡Pide la tuya hoy! 🥣",
      },
      {
        channel: "sms",
        content:
          "{{nombre}}, Avena Quaker Manzana-Canel 300g a $9.700. Desayunos ricos y saludables. Pide ya.",
      },
    ],
    metrics: { audience: 5120, sent: 4980, opened: 2310, converted: 412 },
  },
  {
    name: "Sazón Badía — el toque de tu cocina",
    productIds: [120645],
    mode: "multi",
    tone: "cálido",
    prompt: "Sazón completa Badía para realzar el sabor de las comidas",
    channels: ["email"],
    priorityChannel: "email",
    status: "borrador",
    messages: [
      {
        channel: "email",
        subject: "El secreto de una comida deliciosa está en el sazón 🌿",
        content:
          "¡Hola {{nombre}}! Con Sazón Completa Badía 49.6g tus comidas quedan en su punto exacto. La tenemos a $7.600. Descubre lo fácil que es darle más sabor a lo de siempre.",
      },
    ],
    metrics: { audience: 0, sent: 0, opened: 0, converted: 0 },
  },
  {
    name: "Combo desayuno: Avena + Café",
    productIds: [120413, 120346, 120451],
    mode: "bundle",
    tone: "comercial",
    prompt: "Combo de desayuno con avena y café para arrancar el día",
    channels: ["whatsapp", "email", "sms"],
    priorityChannel: "whatsapp",
    status: "enviando",
    messages: [
      {
        channel: "whatsapp",
        content:
          "¡{{nombre}}, arma tu desayuno perfecto! 🥣☕ Llévate Avena Toning 1000g + Café Colcafé 170g + Avena Quaker en un solo pedido. Aprovecha el combo.",
      },
      {
        channel: "email",
        subject: "Tu combo de desayuno está listo para pedir 🛒",
        content:
          "¡Hola {{nombre}}! Armamos un combo pensado para tus mañanas: Avena Toning 1000g, Café Colcafé 170g y Avena Quaker. Pídelo junto y ahorra.",
      },
      {
        channel: "sms",
        content:
          "{{nombre}}, combo desayuno (Avena Toning + Colcafé + Quaker) disponible. Pídelo en un solo pedido.",
      },
    ],
    metrics: { audience: 2870, sent: 0, opened: 0, converted: 0 },
  },
];

function plusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function post(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function put(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`PUT ${path} → ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Idempotencia: no crear de nuevo las que ya existen por nombre.
const existing = await getJSON("/admin/campaigns");
const existingNames = new Set(existing.map((c) => c.name.trim()));

const created = [];
for (const c of CAMPAIGNS) {
  if (existingNames.has(c.name.trim())) {
    const prev = existing.find((e) => e.name.trim() === c.name.trim());
    console.log(`↷ ya existe #${prev.id} ${JSON.stringify(c.name)} — se omite`);
    continue;
  }
  const payload = {
    name: c.name,
    productId: c.productIds[0],
    productIds: c.productIds,
    prompt: c.prompt,
    tone: c.tone,
    mode: c.mode,
    channels: c.channels,
    priorityChannel: c.priorityChannel,
    messages: c.messages,
  };
  if (c.scheduledAt) payload.scheduledAt = c.scheduledAt;
  const res = await post("/admin/campaigns", payload);
  created.push({ ...c, id: res.id });
}

// Estado (y sentAt) de cada campaña.
for (const c of created) {
  await put(`/admin/campaigns/${c.id}`, {
    status: c.status,
    ...(c.scheduledAt ? { scheduledAt: c.scheduledAt } : {}),
  });
}

// Métricas para que las tarjetas no salgan en 0 (no hay DTO para esto).
const values = created
  .map(
    (c) =>
      `(${c.id}, ${c.metrics.audience}, ${c.metrics.sent}, ${c.metrics.opened}, ${c.metrics.converted}, ${
        c.sentAt ? `'${c.sentAt}'` : "NULL"
      })`,
  )
  .join(",");
if (values) {
  const sql =
    `UPDATE campaigns c SET audience_count=v.audience, sent_count=v.sent, ` +
    `opened_count=v.opened, converted_count=v.converted, sent_at=v.sent_at::timestamptz ` +
    `FROM (VALUES ${values}) AS v(id, audience, sent, opened, converted, sent_at) ` +
    `WHERE c.id = v.id;`;
  execSync(
    `docker exec ecommerce_postgres psql -U postgres -d ecommerce -v ON_ERROR_STOP=1 -c "${sql}"`,
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

// Resumen final (leyendo del API para confirmar).
const list = await getJSON("/admin/campaigns");
const wanted = new Set(CAMPAIGNS.map((c) => c.name.trim()));
console.log("\nCampañas de ejemplo:");
for (const c of list) {
  if (!wanted.has(c.name.trim())) continue;
  console.log(
    `  #${c.id}  ${JSON.stringify(c.name)}  · ${c.status}  · ${c.channels.join(
      "/",
    )}  · audiencia ${c.audienceCount}`,
  );
}
console.log(`\nTotal campañas en el listado: ${list.length}`);

async function getJSON(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}
