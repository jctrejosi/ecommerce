import fs from "node:fs";
import path from "node:path";

const files = [
  "backend/package.json",
  "Interface web client/package.json",
  "Interface web admin/package.json",
  "Interface web delivery admin/package.json",
  "Interface web picking/package.json",
  "Interface web picking admin/package.json",
  "Interface movil client/package.json",
  "Interface movil delivery/package.json",
  "Interface movil picking/package.json",
  "Interface desktop admin/package.json",
  "Interface desktop delivery admin/package.json",
  "Interface desktop picking admin/package.json",
];
const KEY = /(wompi|mercadolibre|ml |google|cloudinary|deepseek|openai|socket|osrm|mapbox|leaflet|firebase|expo|react-native|nestjs|drizzle|stripe|twilio|mail|redis|bull|postgres|pg|jwt|passport|barcode|qr|pdf|excel|xlsx)/i;
for (const f of files) {
  if (!fs.existsSync(f)) { console.log(`\n## ${f} (no existe)`); continue; }
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  const deps = { ...p.dependencies, ...p.devDependencies };
  const names = Object.keys(deps);
  const key = names.filter((n) => KEY.test(n));
  console.log(`\n## ${f}`);
  console.log(`name=${p.name || "?"} scripts=${Object.keys(p.scripts || {}).join(",")}`);
  console.log(`deps=${names.length} key=${key.join(", ")}`);
}

const req = ["bot/requirements.txt", "backend/requirements.txt"].filter((f) => fs.existsSync(f));
for (const f of req) {
  console.log(`\n## ${f}`);
  console.log(fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).join(" | "));
}
