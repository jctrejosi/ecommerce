import fs from "node:fs";
import path from "node:path";

const ROOTS = ["backend/src", "bot", "db", "docker", "deploy", "Interface web client/src", "Interface web admin/src", "Interface web delivery admin/src", "Interface web picking admin/src", "Interface movil client/src", "Interface movil client/app", "Interface movil delivery/src", "Interface movil delivery/app", "Interface movil picking/src", "Interface movil picking/app"];
const EXCLUDE = /node_modules|dist|build|\.expo|android|ios|\.gradle/;
const KW = {
  Wompi: /wompi/i,
  MercadoLibre: /mercadolibre|meli\b|ml_api/i,
  GoogleOAuth: /google.*(oauth|client|login)|@react-oauth|google-signin/i,
  Cloudinary: /cloudinary/i,
  DeepSeek: /deepseek/i,
  OSRM: /osrm/i,
  WebSockets: /socket\.io|websocket|@WebSocketGateway/i,
  ERPAdvantage: /advantage|fortuner|tidsal/i,
  Email: /nodemailer|smtp|mailer|sendgrid|resend/i,
  PushNotif: /expo-notifications|push token|notification/i,
  QR: /qrcode|qr-code|react-native-qrcode|qr\b/i,
  Barcode: /barcode|code128|ean13/i,
  PDF: /pdfkit|pdf-lib|jspdf|pdfmake/i,
  Excel: /exceljs|xlsx/i,
  Geocoding: /geocod|nominatim|mapbox|maplibre|leaflet/i,
  DeliveryRoutes: /delivery.*rout|route.*delivery|osrm/i,
  Picking: /picking|picker|shelf/i,
  Inventory: /inventory|stock|inventario/i,
  Campaigns: /campaign|campana/i,
  Promotions: /promotion|promo|coupon|cupon/i,
  Newsletter: /newsletter|suscrip/i,
  Loyalty: /loyalty|puntos|points/i,
  Branches: /branch|sucursal|bodega/i,
  Payments: /payment|pago|checkout/i,
  Refunds: /refund|devoluci/i,
  Invoicing: /invoice|factura|dian/i,
  Analytics: /analytics|metric|dashboard|kpi/i,
  AuditLog: /audit|auditor/i,
  RateLimit: /throttl|rate.?limit/i,
  Tests: /describe\(|it\(|test\(/i,
};

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (EXCLUDE.test(full)) continue;
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|py|sql|md|yml|yaml|sh|json)$/.test(e.name) && !/package-lock/.test(e.name)) out.push(full);
  }
}

const files = [];
for (const r of ROOTS) walk(r, files);
const hits = {};
for (const f of files) {
  let text = "";
  try {
    if (fs.statSync(f).size > 800_000) continue;
    text = fs.readFileSync(f, "utf8");
  } catch { continue; }
  for (const [k, re] of Object.entries(KW)) {
    const m = text.match(re);
    if (m) {
      hits[k] ??= { files: 0, matches: 0 };
      hits[k].files += 1;
      hits[k].matches += (text.match(new RegExp(re.source, "gi")) || []).length;
    }
  }
}
console.log("feature\tfiles\tmatches");
for (const [k, v] of Object.entries(hits).sort((a, b) => b[1].files - a[1].files)) console.log(`${k}\t${v.files}\t${v.matches}`);

// endpoints backend
let endpoints = 0;
let controllers = 0;
for (const f of files.filter((f) => f.startsWith("backend/src") && f.endsWith(".controller.ts"))) {
  controllers += 1;
  const t = fs.readFileSync(f, "utf8");
  endpoints += (t.match(/@(Get|Post|Put|Patch|Delete)\(/g) || []).length;
}
let botRoutes = 0;
for (const f of files.filter((f) => f.startsWith("bot") && f.endsWith(".py"))) {
  const t = fs.readFileSync(f, "utf8");
  botRoutes += (t.match(/@app\.(get|post|put|patch|delete)\(/g) || []).length;
}
let tables = 0;
try {
  const s = fs.readFileSync("backend/drizzle/schema.ts", "utf8");
  tables = (s.match(/pgTable\(/g) || []).length;
} catch {}
console.log(`\ncontrollers=${controllers} endpoints=${endpoints} botRoutes=${botRoutes} pgTables=${tables}`);

// screens / routes
for (const [label, dir] of [["client web", "Interface web client/src"], ["admin web", "Interface web admin/src"], ["delivery web", "Interface web delivery admin/src"], ["picking web", "Interface web picking admin/src"]]) {
  const src = files.filter((f) => f.startsWith(dir) && f.endsWith(".tsx"));
  let routes = 0;
  for (const f of src) {
    const t = fs.readFileSync(f, "utf8");
    routes += (t.match(/<Route[\s>]/g) || []).length;
  }
  console.log(`${label}: tsxFiles=${src.length} routeTags=${routes}`);
}
for (const [label, dir] of [["client mobile", "Interface movil client/app"], ["delivery mobile", "Interface movil delivery/app"], ["picking mobile", "Interface movil picking/app"]]) {
  const pages = files.filter((f) => f.startsWith(dir) && /\.tsx$/.test(f) && !/_layout|components/.test(f));
  console.log(`${label}: pages=${pages.length}`);
}

// tests
const testFiles = [];
for (const f of files) if (/\.(test|spec)\.(ts|tsx|js|jsx|py)$/.test(f) || /__tests__/.test(f)) testFiles.push(f);
console.log(`testFiles=${testFiles.length}`);
