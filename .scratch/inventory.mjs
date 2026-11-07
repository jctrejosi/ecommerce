import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo",
  ".venv", "venv", "__pycache__", "target", ".gradle", "vendor", "backups",
  ".expo", "Pods", ".dart_tool", ".idea", ".vscode", "release", "debug",
]);
const EXCLUDE_FILES = [
  /^package-lock\.json$/, /^yarn\.lock$/, /^pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/, /\.map$/, /\.(png|jpe?g|gif|webp|svg|ico|apk|aab|jar|pdf|zip|woff2?|ttf|eot|mp4|mov)$/i,
  /^DATABASE-schema\.json$/, /^TIDSAL-.*\.json$/,
];
const LANG = {
  ts: "TS", tsx: "TSX", js: "JS", jsx: "JSX", mjs: "JS", cjs: "JS",
  css: "CSS", scss: "CSS", html: "HTML", py: "PY",
  kt: "KOTLIN", dart: "DART", swift: "SWIFT", java: "JAVA",
  sql: "SQL", sh: "SHELL", bash: "SHELL", ps1: "SHELL",
  yml: "YAML", yaml: "YAML", toml: "YAML", json: "JSON", md: "MD",
};
const CODE = new Set(["TS", "TSX", "JS", "JSX", "PY", "KOTLIN", "DART", "SWIFT", "JAVA", "SQL", "CSS", "HTML", "SHELL"]);

function isExcludedFile(name) {
  return EXCLUDE_FILES.some((re) => re.test(name));
}

function walk(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) walk(path.join(dir, e.name), acc);
      continue;
    }
    if (!e.isFile() || isExcludedFile(e.name)) continue;
    const ext = path.extname(e.name).slice(1).toLowerCase();
    const lang = LANG[ext];
    if (!lang) continue;
    const full = path.join(dir, e.name);
    let text;
    try {
      const st = fs.statSync(full);
      if (st.size > 1_500_000) { acc.big.push(path.relative(ROOT, full)); continue; }
      text = fs.readFileSync(full, "utf8");
    } catch { continue; }
    const lines = text.length ? text.split("\n").length : 0;
    acc.files += 1;
    acc.total += lines;
    acc.byLang[lang] = (acc.byLang[lang] || 0) + lines;
    if (CODE.has(lang)) acc.code += lines;
    if (/\.(test|spec)\.(ts|tsx|js|jsx|py|kt|dart)$/.test(e.name) || /__(tests|mocks)__/.test(full)) {
      acc.testFiles += 1;
      acc.testLines += lines;
    }
  }
}

const workspaces = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !EXCLUDE_DIRS.has(e.name) && !e.name.startsWith("."))
  .map((e) => e.name)
  .sort();

const rows = [];
for (const ws of workspaces) {
  const acc = { files: 0, total: 0, code: 0, testFiles: 0, testLines: 0, byLang: {}, big: [] };
  walk(path.join(ROOT, ws), acc);
  if (acc.files) rows.push({ ws, ...acc });
}
const rootAcc = { files: 0, total: 0, code: 0, testFiles: 0, testLines: 0, byLang: {}, big: [] };
for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!e.isFile() || isExcludedFile(e.name)) continue;
  const ext = path.extname(e.name).slice(1).toLowerCase();
  const lang = LANG[ext];
  if (!lang) continue;
  const text = fs.readFileSync(path.join(ROOT, e.name), "utf8");
  const lines = text.split("\n").length;
  rootAcc.files += 1; rootAcc.total += lines; rootAcc.byLang[lang] = (rootAcc.byLang[lang] || 0) + lines;
  if (CODE.has(lang)) rootAcc.code += lines;
}
if (rootAcc.files) rows.push({ ws: "(raíz)", ...rootAcc });

rows.sort((a, b) => b.code - a.code);
console.log("workspace\tfiles\tcode\tall\tTS\tTSX\tJS\tPY\tCSS\tHTML\tSQL\tKOTLIN\tDART\tJSON\tMD\ttests");
for (const r of rows) {
  const g = (k) => r.byLang[k] || 0;
  console.log(`${r.ws}\t${r.files}\t${r.code}\t${r.total}\t${g("TS")}\t${g("TSX")}\t${g("JS")}\t${g("PY")}\t${g("CSS")}\t${g("HTML")}\t${g("SQL")}\t${g("KOTLIN")}\t${g("DART")}\t${g("JSON")}\t${g("MD")}\t${r.testFiles}/${r.testLines}`);
}
const sum = rows.reduce((a, r) => ({ code: a.code + r.code, files: a.files + r.files, testLines: a.testLines + r.testLines, testFiles: a.testFiles + r.testFiles }), { code: 0, files: 0, testLines: 0, testFiles: 0 });
console.log(`TOTAL\t${sum.files}\t${sum.code}\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t${sum.testFiles}/${sum.testLines}`);
