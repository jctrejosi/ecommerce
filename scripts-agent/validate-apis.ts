/**
 * Valida API por API del backend (contra localhost:3000).
 * Solo imprime status + resumen corto, sin volcar payloads al chat.
 */
const BASE = "http://localhost:3000";
const short = (s: string, n = 110) => s.replace(/\s+/g, " ").slice(0, n);

async function call(name: string, path: string, init?: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(BASE + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    const body = short(text);
    console.log(`${res.ok ? "✅" : "❌"} [${res.status}] ${name}: ${body}`);
    return res.ok;
  } catch (e) {
    console.log(`❌ ${name}: ${(e as Error).message}`);
    return false;
  }
}

async function main() {
  await call("api-status", "/api-status");
  await call("categories", "/catalog/categories");
  await call("product-types", "/catalog/product-types");
  await call("landing/product-types", "/landing/product-types");
  await call("brands", "/catalog/brands");
  await call("brands/featured", "/catalog/brands/featured");
  await call("featured/tabs", "/featured/tabs");
  await call("banners hero", "/banners?bannerType=hero");
  await call("popups", "/popups/active");
  await call("qr/config", "/qr/config");

  const products = await fetch(BASE + "/catalog/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 5 }),
  }).then((r) => r.json() as Promise<any[]>);
  console.log(`✅ products(limit5): ${products.length} filas | muestra: ${products.slice(0, 2).map((p) => p.name).join(" · ")}`);
  const id = products[0]?.id;
  if (id) {
    await call(`related(${id})`, `/catalog/products/${id}/related`);
    const s = await fetch(BASE + "/catalog/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search: "leche", limit: 3 }),
    }).then((r) => r.json() as Promise<any[]>);
    console.log(`✅ search 'leche': ${s.length} filas | ${s.slice(0, 2).map((p) => p.name).join(" · ")}`);
  }

  // ── Auth ──
  const email = `qa.${Date.now()}@mercaldas.test`;
  const reg = await fetch(BASE + "/customer-auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "QA",
      lastName: "Mercaldas",
      email,
      password: "Qa123456",
      phone: "3001234567",
      acceptsTerms: true,
    }),
  });
  const regBody = await reg.json().catch(() => ({}));
  console.log(`${reg.ok ? "✅" : "❌"} [${reg.status}] register: ${short(JSON.stringify(regBody).replace(/(accessToken|refreshToken)":"[^"]+"/g, '$1":"***"'))}`);
  const token: string | undefined = regBody.accessToken;

  const login = await fetch(BASE + "/customer-auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Qa123456" }),
  });
  const loginBody = await login.json().catch(() => ({}));
  console.log(`${login.ok ? "✅" : "❌"} [${login.status}] login: ${short(JSON.stringify({ ...loginBody, accessToken: "***", refreshToken: "***" }))}`);
  const authToken: string | undefined = loginBody.accessToken ?? token;

  if (authToken) {
    await call("me", "/customer-auth/me", { headers: { Authorization: `Bearer ${authToken}` } });
    await call("orders", "/orders", { headers: { Authorization: `Bearer ${authToken}` } });
    await call("addresses", "/customer-auth/addresses", { headers: { Authorization: `Bearer ${authToken}` } });
  }

  // ── Checkout invitado ──
  if (id) {
    const co = await fetch(BASE + "/orders/guest-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: id, quantity: 1 }],
        address: {
          name: "QA",
          phone: "3001234567",
          email: "qa@mercaldas.test",
          address: "Cra 1 # 2-3",
          city: "Manizales",
        },
        shippingType: "standard",
        paymentMethod: "efectivo",
      }),
    });
    const coBody = await co.json().catch(() => ({}));
    console.log(`${co.ok ? "✅" : "❌"} [${co.status}] guest-checkout: ${short(JSON.stringify(coBody))}`);
    const code = coBody.referenceCode;
    if (code) {
      await call(`track(${code})`, `/orders/track/${code}`);
      await call(`track(${code})/live`, `/orders/track/${code}/live`);
      await call(`track(${code})/route`, `/orders/track/${code}/route`);
    }
  }

  await call("social-login (sin token, debe 401/400)", "/customer-auth/social-login", {
    method: "POST",
    body: JSON.stringify({ provider: "google", accessToken: "invalid" }),
  });
}

void main();
