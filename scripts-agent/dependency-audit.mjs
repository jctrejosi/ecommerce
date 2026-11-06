#!/usr/bin/env node
/**
 * Auditoría de dependencias del monorepo.
 * Recorre cada manifiesto, ejecuta el auditor del gestor correspondiente
 * (npm/pnpm), consulta OSV para Python y Rust, y escribe un informe en
 * docs/DEPENDENCIA_AUDITORIA.md. La consola solo imprime un resumen.
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = process.cwd();
const OUT_JSON = path.join(ROOT, 'scripts-agent', 'out', 'dependency-audit.json');
const OUT_MD = path.join(ROOT, 'docs', 'DEPENDENCIA_AUDITORIA.md');

const NODE_PROJECTS = [
  { dir: 'backend', pm: 'yarn' },
  { dir: 'e2e', pm: 'npm' },
  { dir: 'Interface desktop admin', pm: 'npm' },
  { dir: 'Interface desktop delivery admin', pm: 'npm' },
  { dir: 'Interface desktop picking admin', pm: 'npm' },
  { dir: 'Interface web client', pm: 'pnpm' },
  { dir: 'Interface web admin', pm: 'pnpm' },
  { dir: 'Interface web delivery admin', pm: 'pnpm' },
  { dir: 'Interface web picking admin', pm: 'pnpm' },
  { dir: 'Interface movil client', pm: 'pnpm' },
  { dir: 'Interface movil delivery', pm: 'pnpm' },
  { dir: 'Interface movil picking', pm: 'pnpm' },
];

const SEV_ORDER = { critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 5 };

function safeJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const arr = text.indexOf('[');
  let s = start;
  if (arr !== -1 && (s === -1 || arr < s)) s = arr;
  if (s === -1) return null;
  try {
    return JSON.parse(text.slice(s));
  } catch {
    return null;
  }
}

async function cmd(bin, args, cwd) {
  try {
    const { stdout, stderr } = await run(bin, args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
      env: { ...process.env, NO_COLOR: '1', CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? String(err) };
  }
}

async function readJson(p) {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

function parentFromNodePath(nodePath, name) {
  const parts = String(nodePath).split('node_modules/').filter(Boolean);
  if (parts.length < 2) return null;
  const parent = parts[parts.length - 2].replace(/\/$/, '');
  return parent && parent !== name ? parent : null;
}

/** Normaliza el resultado de `npm audit --json`. */
function parseNpmAudit(raw, prodOnly) {
  const vulns = [];
  const data = raw?.vulnerabilities ?? {};
  for (const [name, v] of Object.entries(data)) {
    const via = (v.via ?? []).filter((x) => typeof x === 'object');
    const titles = via.map((x) => x.title).filter(Boolean);
    const parents = [...new Set((v.nodes ?? []).map((n) => parentFromNodePath(n, name)).filter(Boolean))];
    vulns.push({
      name,
      severity: v.severity ?? 'unknown',
      isDirect: !!v.isDirect,
      range: v.range ?? '',
      titles: [...new Set(titles)],
      urls: [...new Set(via.map((x) => x.url).filter(Boolean))],
      fixAvailable: v.fixAvailable
        ? typeof v.fixAvailable === 'object'
          ? `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (major)' : ''}`
          : 'sí'
        : 'no',
      via: parents.slice(0, 3),
      prodOnly,
    });
  }
  return vulns;
}

/** Normaliza el resultado de `pnpm audit --json` (formato advisories). */
function parsePnpmAudit(raw, prodOnly) {
  const out = new Map();
  const advisories = raw?.advisories ?? {};
  for (const adv of Object.values(advisories)) {
    for (const f of adv.findings ?? []) {
      const key = `${adv.module_name}@${f.version}`;
      if (out.has(key)) continue;
      const patched = (adv.patched_versions ?? '').replace(/^>=\s*/, '');
      const parents = [
        ...new Set(
          (f.paths ?? [])
            .map((p) => p.replace(/^\.>/, '').split('>')[0])
            .filter((p) => p && p !== adv.module_name),
        ),
      ];
      out.set(key, {
        name: adv.module_name,
        severity: adv.severity ?? 'unknown',
        isDirect: (f.paths ?? []).some((p) => p.split('>').filter(Boolean).length <= 2),
        range: adv.vulnerable_versions ?? '',
        titles: [adv.title].filter(Boolean),
        urls: [adv.url].filter(Boolean),
        fixAvailable: patched && patched !== '<0.0.0' ? `>=${patched}` : 'no',
        via: parents.slice(0, 3),
        prodOnly,
      });
    }
  }
  // Formato tipo npm (pnpm >= 10 en algunos casos)
  if (out.size === 0 && raw?.vulnerabilities) {
    return parseNpmAudit(raw, prodOnly);
  }
  return [...out.values()];
}

function mergeVulns(full, prod) {
  const map = new Map();
  for (const v of full) map.set(`${v.name}@${v.range}@${v.severity}`, { ...v, prod: false });
  for (const v of prod) {
    const k = `${v.name}@${v.range}@${v.severity}`;
    if (map.has(k)) map.get(k).prod = true;
    else map.set(k, { ...v, prod: true });
  }
  return [...map.values()];
}

function parseOutdated(raw) {
  if (!raw) return [];
  const obj = Array.isArray(raw) ? Object.fromEntries(raw.map((x) => [x.packageName, x])) : raw;
  const rows = [];
  for (const [name, v] of Object.entries(obj)) {
    if (!v || typeof v !== 'object' || !v.latest) continue;
    rows.push({
      name,
      current: v.current ?? '?',
      wanted: v.wanted ?? '?',
      latest: v.latest,
      type: v.dependencyType ?? '',
    });
  }
  return rows;
}

function bumpType(current, latest) {
  const c = String(current).split('.').map((n) => parseInt(n, 10) || 0);
  const l = String(latest).split('.').map((n) => parseInt(n, 10) || 0);
  if (l[0] > c[0]) return 'major';
  if (l[1] > c[1]) return 'minor';
  if (l[2] > c[2]) return 'patch';
  return 'none';
}

/** Normaliza `yarn audit --json` (NDJSON, yarn v1). */
function parseYarnAudit(text, prodOnly) {
  const byId = new Map();
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type !== 'auditAdvisory') continue;
    const a = j.data.advisory;
    const id = j.data.resolution?.id ?? `${a.module_name}|${a.vulnerable_versions}`;
    if (!byId.has(id)) {
      const parents = [
        ...new Set(
          (a.findings ?? [])
            .flatMap((f) => f.paths ?? [])
            .map((p) => p.split('>')[0])
            .filter((p) => p && p !== a.module_name),
        ),
      ];
      byId.set(id, {
        name: a.module_name,
        severity: a.severity ?? 'unknown',
        isDirect: (a.findings ?? []).some((f) => (f.paths ?? []).some((p) => !p.includes('>'))),
        range: a.vulnerable_versions ?? '',
        titles: [a.title].filter(Boolean),
        urls: [a.url].filter(Boolean),
        fixAvailable: a.patched_versions && a.patched_versions !== '<0.0.0' ? a.patched_versions : 'no',
        found: [...new Set((a.findings ?? []).map((f) => f.version).filter(Boolean))],
        via: parents.slice(0, 3),
        prodOnly,
      });
    } else {
      const v = byId.get(id);
      for (const f of a.findings ?? []) if (f.version && !v.found.includes(f.version)) v.found.push(f.version);
    }
  }
  return [...byId.values()];
}

function parseYarnOutdated(text) {
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type === 'table' && Array.isArray(j.data?.body)) {
      return j.data.body
        .filter((r) => Array.isArray(r) && r.length >= 4)
        .map((r) => ({ name: r[0], current: r[1], wanted: r[2], latest: r[3], type: r[4] ?? '' }));
    }
  }
  return [];
}

async function installedVersion(dir, name) {
  const j = await readJson(path.join(dir, 'node_modules', name, 'package.json'));
  return j?.version ?? null;
}

function versionLt(a, b) {
  const pa = String(a).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

async function auditNode(project) {
  const dir = path.join(ROOT, project.dir);
  const pkg = await readJson(path.join(dir, 'package.json'));
  if (!pkg) return null;
  const isPnpm = project.pm === 'pnpm';
  const isYarn = project.pm === 'yarn';
  const bin = isPnpm ? 'pnpm' : isYarn ? 'yarn' : 'npm';

  let vulns;
  let auditError = null;
  let outdated;

  if (isYarn) {
    const full = await cmd('yarn', ['audit', '--json'], dir);
    const prod = await cmd('yarn', ['audit', '--groups', 'dependencies', '--json'], dir);
    if (!/auditAdvisory|auditSummary/.test(full.stdout)) auditError = (full.stderr || 'sin salida').slice(0, 300);
    vulns = mergeVulns(parseYarnAudit(full.stdout, false), parseYarnAudit(prod.stdout, true));
    outdated = parseYarnOutdated((await cmd('yarn', ['outdated', '--json'], dir)).stdout);
  } else {
    const full = await cmd(bin, ['audit', '--json'], dir);
    const prodArgs = isPnpm ? ['audit', '--prod', '--json'] : ['audit', '--omit=dev', '--json'];
    const prod = await cmd(bin, prodArgs, dir);
    const fullData = safeJson(full.stdout);
    const prodData = safeJson(prod.stdout);
    const parse = isPnpm ? parsePnpmAudit : parseNpmAudit;
    vulns = mergeVulns(parse(fullData, false), parse(prodData, true));
    auditError = !fullData ? (full.stderr || 'sin salida JSON').slice(0, 300) : null;
    const outdatedRaw = safeJson((await cmd(bin, ['outdated', '--json'], dir)).stdout);
    outdated = parseOutdated(outdatedRaw);
  }
  outdated = outdated.map((o) => ({ ...o, jump: bumpType(o.current, o.latest) }));

  const direct = {
    dependencies: Object.keys(pkg.dependencies ?? {}).length,
    devDependencies: Object.keys(pkg.devDependencies ?? {}).length,
  };
  const directNames = [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])];
  const installed = {};
  await Promise.all(
    directNames.map(async (n) => {
      installed[n] = await installedVersion(dir, n);
    }),
  );
  // Solo cuenta como "directa vulnerable" si la versión instalada de esa
  // dependencia cae en el rango (evita atribuir a la directa un uuid antiguo
  // que en realidad es transitivo).
  const directVulns = [];
  for (const name of directNames) {
    const inst = installed[name];
    for (const v of vulns) {
      if (v.name !== name) continue;
      if (v.found?.length && inst && !v.found.includes(inst)) continue;
      directVulns.push({
        name,
        severity: v.severity,
        prod: v.prod,
        fix: v.fixAvailable,
        installed: inst ?? v.found?.[0] ?? '',
      });
    }
  }
  return {
    kind: 'node',
    dir: project.dir,
    pm: isPnpm ? 'pnpm' : isYarn ? 'yarn' : 'npm',
    auditError,
    direct,
    directVulns,
    vulns,
    outdated,
  };
}

function parseRequirements(text) {
  const deps = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.startsWith('-r ') || l.startsWith('-c ')) continue;
    const m = l.match(/^([A-Za-z0-9_.\-\[\]]+)\s*(==|>=|~=|>|<)?\s*([^\s;#]+)?/);
    if (!m) continue;
    const name = m[1].replace(/\[.*\]$/, '');
    deps.push({ name, op: m[2] ?? null, version: m[2] === '==' ? (m[3] ?? null) : null, raw: l });
  }
  return deps;
}

async function osvQueryBatch(queries) {
  if (!queries.length) return [];
  const res = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ queries }),
  });
  if (!res.ok) throw new Error(`OSV ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

async function osvDetail(id) {
  try {
    const res = await fetch(`https://api.osv.dev/v1/vulns/${id}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function latestPyPI(name) {
  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (!res.ok) return null;
    const d = await res.json();
    return d.info?.version ?? null;
  } catch {
    return null;
  }
}

function cvssHeuristic(vec) {
  if (!vec || typeof vec !== 'string') return 'unknown';
  const high = /\/[CIA]:H/.test(vec);
  if (high && !/AC:H/.test(vec)) return 'high';
  if (high) return 'moderate';
  if (/\/[CIA]:L/.test(vec)) return 'moderate';
  return 'low';
}

function normalizeSeverity(dbSeverity, vectors) {
  if (typeof dbSeverity === 'string' && dbSeverity) {
    const s = dbSeverity.toLowerCase();
    if (s in SEV_ORDER) return { value: s, estimated: false };
  }
  for (const v of vectors ?? []) {
    if (typeof v?.score === 'string') {
      return { value: cvssHeuristic(v.score), estimated: true };
    }
  }
  return { value: 'unknown', estimated: false };
}

async function auditPython() {
  const files = [];
  for (const rel of ['bot/requirements.txt', 'bot/requirements-dev.txt', 'test_db/requirements.txt', 'test_db/api/requirements.txt']) {
    try {
      const text = await readFile(path.join(ROOT, rel), 'utf8');
      files.push({ file: rel, deps: parseRequirements(text) });
    } catch {
      /* ignorado */
    }
  }
  const exact = [];
  for (const f of files) for (const d of f.deps) if (d.version) exact.push({ ...d, file: f.file });
  const uniq = [...new Map(exact.map((d) => [`${d.name}@${d.version}`, d])).values()];

  const results = await osvQueryBatch(
    uniq.map((d) => ({ package: { name: d.name, ecosystem: 'PyPI' }, version: d.version })),
  );
  // Agrupa por paquete@versión (GHSA/PYSEC/CVE del mismo fallo son la misma fila)
  const grouped = new Map();
  for (let i = 0; i < uniq.length; i++) {
    for (const v of results[i]?.vulns ?? []) {
      const key = `${uniq[i].name}@${uniq[i].version}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          name: uniq[i].name,
          version: uniq[i].version,
          file: uniq[i].file,
          ids: new Set(),
          summary: v.summary ?? '',
          severity: 'unknown',
          estimated: false,
        });
      }
      const g = grouped.get(key);
      g.ids.add(v.id);
      for (const a of v.aliases ?? []) g.ids.add(a);
      if (!g.summary && v.summary) g.summary = v.summary;
    }
  }
  // Severidad y resumen desde el detalle (OSV batch no siempre los trae)
  for (const g of grouped.values()) {
    const detail = await osvDetail([...g.ids][0]);
    const n = normalizeSeverity(detail?.database_specific?.severity, detail?.severity);
    g.severity = n.value;
    g.estimated = n.estimated;
    if (!g.summary && detail?.summary) g.summary = detail.summary;
  }
  const vulns = [...grouped.values()].map((g) => ({ ...g, ids: [...g.ids] }));

  const latest = {};
  await Promise.all(
    [...new Set(files.flatMap((f) => f.deps.map((d) => d.name)))].map(async (n) => {
      latest[n] = await latestPyPI(n);
    }),
  );
  return { files, vulns, latest };
}

async function auditRust() {
  const cargoToml = await readFile(path.join(ROOT, 'backend-tracking', 'Cargo.toml'), 'utf8');
  const lock = await readFile(path.join(ROOT, 'backend-tracking', 'Cargo.lock'), 'utf8');

  const direct = [...cargoToml.matchAll(/^([a-zA-Z0-9_-]+)\s*=\s*(?:"|\{)/gm)].map((m) => m[1]);
  const declared = new Map();
  const depsBlock = cargoToml.split(/^\[dependencies\]$/m)[1]?.split(/^\[/m)[0] ?? '';
  for (const m of depsBlock.matchAll(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/gm)) declared.set(m[1], m[2]);
  for (const m of depsBlock.matchAll(/^([a-zA-Z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/gm)) declared.set(m[1], m[2]);

  const locked = [];
  for (const block of lock.split('[[package]]')) {
    const name = block.match(/\nname = "([^"]+)"/)?.[1];
    const version = block.match(/\nversion = "([^"]+)"/)?.[1];
    if (name && version) locked.push({ name, version });
  }

  const results = await osvQueryBatch(
    locked.map((p) => ({ package: { name: p.name, ecosystem: 'crates.io' }, version: p.version })),
  );
  const grouped = new Map();
  for (let i = 0; i < locked.length; i++) {
    for (const v of results[i]?.vulns ?? []) {
      const key = `${locked[i].name}@${locked[i].version}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          name: locked[i].name,
          version: locked[i].version,
          ids: new Set(),
          summary: v.summary ?? '',
          severity: 'unknown',
          estimated: false,
          isDirect: direct.includes(locked[i].name),
        });
      }
      const g = grouped.get(key);
      g.ids.add(v.id);
      for (const a of v.aliases ?? []) g.ids.add(a);
      if (!g.summary && v.summary) g.summary = v.summary;
    }
  }
  for (const g of grouped.values()) {
    const detail = await osvDetail([...g.ids][0]);
    const n = normalizeSeverity(detail?.database_specific?.severity, detail?.severity);
    g.severity = n.value;
    g.estimated = n.estimated;
    if (!g.summary && detail?.summary) g.summary = detail.summary;
  }
  const vulns = [...grouped.values()].map((g) => ({ ...g, ids: [...g.ids] }));

  const latest = {};
  await Promise.all(
    [...declared.keys()].map(async (name) => {
      try {
        const res = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
          headers: { 'user-agent': 'mercaldas-dependency-audit/1.0' },
        });
        if (!res.ok) return;
        latest[name] = (await res.json()).crate?.max_stable_version ?? null;
      } catch {
        /* ignorado */
      }
    }),
  );
  return { declared: Object.fromEntries(declared), vulns, latest, lockedCount: locked.length };
}

function countBySeverity(vulns) {
  const c = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
  for (const v of vulns) {
    const s = c[v.severity] === undefined ? 'unknown' : v.severity;
    c[s]++;
  }
  return c;
}

function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

function nodeSection(projects) {
  const lines = [];
  lines.push('## 1. Proyectos Node.js / TypeScript\n');
  lines.push('| Proyecto | Gestor | Deps prod | Deps dev | Críticas | Altas | Medias | Bajas | Total | En prod |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  let t = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
  for (const p of projects) {
    const c = countBySeverity(p.vulns);
    for (const k of Object.keys(t)) t[k] += c[k];
    lines.push(
      `| \`${esc(p.dir)}\` | ${p.pm} | ${p.direct.dependencies} | ${p.direct.devDependencies} | ${c.critical} | ${c.high} | ${c.moderate} | ${c.low} | ${p.vulns.length} | ${p.vulns.filter((v) => v.prod).length} |`,
    );
  }
  lines.push(
    `| **TOTAL** | | | | **${t.critical}** | **${t.high}** | **${t.moderate}** | **${t.low}** | **${t.critical + t.high + t.moderate + t.low + t.unknown}** | |`,
  );
  lines.push('');
  for (const p of projects) {
    if (!p.vulns.length) {
      lines.push(`### ${p.dir}\n\nSin vulnerabilidades conocidas.\n`);
      continue;
    }
    const sorted = [...p.vulns].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
    lines.push(`### ${p.dir}\n`);
    lines.push('| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const v of sorted) {
      const tip = v.titles?.[0] ?? '';
      const link = v.urls?.[0] ? `[${esc(tip || v.urls[0])}](${v.urls[0]})` : esc(tip);
      const found = v.found?.length ? ` (inst. ${v.found.join(', ')})` : '';
      const via = v.via?.length ? v.via.map((x) => `\`${x}\``).join(', ') : v.isDirect ? 'directa' : '—';
      lines.push(
        `| \`${esc(v.name)}\` | ${v.severity} | ${v.prod ? 'prod' : 'dev'} | \`${esc(v.range)}\`${found} | ${v.isDirect ? 'sí' : 'no'} | ${via} | ${esc(v.fixAvailable)} | ${link} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function outdatedSection(projects) {
  const lines = [];
  lines.push('## 2. Dependencias directas desactualizadas (Node)\n');
  const rows = [];
  for (const p of projects) for (const o of p.outdated) rows.push({ project: p.dir, ...o });
  const majors = rows.filter((r) => r.jump === 'major');
  lines.push(
    `Total de dependencias directas con versión más nueva: **${rows.length}** ` +
      `(major: **${majors.length}**, minor: **${rows.filter((r) => r.jump === 'minor').length}**, ` +
      `patch: **${rows.filter((r) => r.jump === 'patch').length}**).\n`,
  );
  for (const p of projects) {
    const own = p.outdated.sort((a, b) => (b.jump === 'major') - (a.jump === 'major') || a.name.localeCompare(b.name));
    if (!own.length) continue;
    lines.push(`### ${p.dir}\n`);
    lines.push('| Paquete | Actual | Latest | Tipo | Salto |');
    lines.push('|---|---|---|---|---|');
    for (const o of own) {
      lines.push(`| \`${esc(o.name)}\` | ${esc(o.current)} | ${esc(o.latest)} | ${esc(o.type)} | ${o.jump} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function pythonSection(py) {
  const lines = [];
  lines.push('## 3. Python (bot + test_db)\n');
  const sev = countBySeverity(py.vulns);
  lines.push(
    `Vulnerabilidades OSV: **${py.vulns.length}** (críticas ${sev.critical}, altas ${sev.high}, medias ${sev.moderate}, bajas ${sev.low}).\n`,
  );
  if (py.vulns.length) {
    lines.push('| Paquete | Versión | Severidad | IDs | Resumen |');
    lines.push('|---|---|---|---|---|');
    for (const v of py.vulns) {
      lines.push(
        `| \`${esc(v.name)}\` | ${esc(v.version)} | ${esc(v.severity)}${v.estimated ? ' (est.)' : ''} | ${esc(v.ids.join(', '))} | ${esc(v.summary)} |`,
      );
    }
    lines.push('');
  }
  lines.push('### Freshness\n');
  lines.push('| Archivo | Paquete | Declarado | Última versión |');
  lines.push('|---|---|---|---|');
  for (const f of py.files) {
    for (const d of f.deps) {
      const latest = py.latest[d.name] ? `\`${py.latest[d.name]}\`` : '?';
      const note = d.version ? `\`==${d.version}\`` : `\`${d.raw.replace(d.name, '')}\` (sin pin)`;
      lines.push(`| ${esc(f.file)} | \`${esc(d.name)}\` | ${note} | ${latest} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function rustSection(rs) {
  const lines = [];
  lines.push('## 4. Rust (`backend-tracking`)\n');
  lines.push(`Crates en \`Cargo.lock\`: **${rs.lockedCount}**. Vulnerabilidades OSV: **${rs.vulns.length}**.\n`);
  if (rs.vulns.length) {
    lines.push('| Crate | Versión | Severidad | Directa | IDs | Resumen |');
    lines.push('|---|---|---|---|---|---|');
    for (const v of rs.vulns) {
      lines.push(
        `| \`${esc(v.name)}\` | ${esc(v.version)} | ${esc(v.severity)}${v.estimated ? ' (est.)' : ''} | ${v.isDirect ? 'sí' : 'no'} | ${esc(v.ids.join(', '))} | ${esc(v.summary)} |`,
      );
    }
    lines.push('');
  }
  lines.push('### Freshness de dependencias directas\n');
  lines.push('| Crate | Declarado | Última estable |');
  lines.push('|---|---|---|');
  for (const [name, declared] of Object.entries(rs.declared)) {
    lines.push(`| \`${name}\` | \`${declared}\` | \`${rs.latest[name] ?? '?'}\` |`);
  }
  lines.push('');
  return lines.join('\n');
}

function crossMapSection(node, py, rs) {
  const map = new Map();
  const add = (name, severity, project, fix, direct) => {
    if (!map.has(name)) map.set(name, { name, severity, projects: new Set(), fix: '', direct: false });
    const e = map.get(name);
    if ((SEV_ORDER[severity] ?? 9) < (SEV_ORDER[e.severity] ?? 9)) e.severity = severity;
    e.projects.add(project);
    if (direct) e.direct = true;
    if (fix && (!e.fix || (e.fix === 'no' && fix !== 'no') || /^>=/.test(fix))) e.fix = fix;
  };
  for (const p of node) {
    for (const v of p.vulns) add(v.name, v.severity, p.dir, v.fixAvailable, v.isDirect);
  }
  for (const v of py.vulns) add(v.name, v.severity, 'bot (PyPI)', 'ver requisitos', false);
  for (const v of rs.vulns) add(v.name, v.severity, 'backend-tracking (crates.io)', 'ver Cargo.lock', v.isDirect);

  const rows = [...map.values()].sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || b.projects.size - a.projects.size,
  );
  const lines = [];
  lines.push('## 5. Mapa cruzado por paquete\n');
  lines.push(`${rows.length} paquetes distintos concentran los hallazgos. Los que aparecen en más proyectos son los de mayor retorno si se corrigen en bloque.\n`);
  lines.push('| Paquete | Severidad máx. | Proyectos afectados | Corrección |');
  lines.push('|---|---|---:|---|');
  for (const r of rows) {
    lines.push(
      `| \`${esc(r.name)}\` | ${r.severity} | ${r.projects.size} | ${esc(r.fix || '—')} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function actionsSection(node) {
  const lines = [];
  lines.push('## 6. Acciones inmediatas (críticas y altas)\n');
  lines.push(
    'Cada fila indica el paquete vulnerable, la versión instalada y la **dependencia directa a subir** cuando el fallo es transitivo.\n',
  );
  let any = false;
  for (const p of node) {
    const seen = new Set();
    const rows = [];
    for (const v of p.vulns) {
      if (v.severity !== 'critical' && v.severity !== 'high') continue;
      const via = v.via?.length ? v.via.join(', ') : v.isDirect ? '(directa)' : '(transitiva)';
      const key = `${v.name}|${via}|${v.prod}|${v.severity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const installed =
        v.found?.join(', ') || p.outdated.find((o) => o.name === v.name)?.current || '';
      rows.push({ name: v.name, severity: v.severity, prod: v.prod, via, fix: v.fixAvailable, installed });
    }
    if (!rows.length) continue;
    any = true;
    rows.sort(
      (a, b) =>
        (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) ||
        Number(b.prod) - Number(a.prod) ||
        a.name.localeCompare(b.name),
    );
    lines.push(`### ${p.dir}\n`);
    lines.push('| Paquete vulnerable | Instalada | Severidad | Alcance | Subir | Corrección del paquete |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of rows) {
      lines.push(
        `| \`${esc(r.name)}\` | ${esc(r.installed || '—')} | ${r.severity} | ${r.prod ? 'prod' : 'dev'} | ${esc(r.via)} | ${esc(r.fix)} |`,
      );
    }
    lines.push('');
  }
  if (!any) lines.push('Sin vulnerabilidades críticas o altas.\n');
  return lines.join('\n');
}

function buildMarkdown(data) {
  const date = new Date().toISOString().slice(0, 10);
  const totalNode = data.node.reduce((n, p) => n + p.vulns.length, 0);
  const prodNode = data.node.reduce((n, p) => n + p.vulns.filter((v) => v.prod).length, 0);
  const sev = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
  for (const p of data.node) for (const [k, v] of Object.entries(countBySeverity(p.vulns))) sev[k] += v;

  return `# Auditoría de dependencias — Mercaldas ecommerce

Generado: ${date} · Herramientas: npm audit, pnpm audit, OSV.dev (Python/Rust), registros npm/PyPI/crates.io.

## Resumen ejecutivo

- **${data.node.length} proyectos Node** auditados con su gestor real (\`npm\`, \`pnpm\` o \`yarn\`).
- **${totalNode} hallazgos** de vulnerabilidad en Node (${sev.critical} críticas, ${sev.high} altas, ${sev.moderate} medias, ${sev.low} bajas).
- **${prodNode}** de esos hallazgos afectan a dependencias de **producción**; el resto son de desarrollo/build.
- **${data.node.reduce((n, p) => n + p.outdated.length, 0)}** dependencias directas Node tienen versión más nueva.
- Python: **${data.python.vulns.length}** hallazgos OSV. Rust: **${data.rust.vulns.length}** hallazgos OSV.
- \`Interface web picking/\` contiene solo \`node_modules\` (sin \`package.json\` ni lock): instalación huérfana, no auditable.

> Notas de alcance:
>
> - \`backend\` se audita con **yarn**, que es el gestor del Dockerfile y del CI (\`yarn install --frozen-lockfile\`). Se eliminó su \`package-lock.json\` obsoleto (contenía paquetes que no existen en \`yarn.lock\`).
> - Las SPAs web usan **pnpm** en Docker y en el job E2E del CI (\`pnpm-lock.yaml\`); se eliminaron los \`package-lock.json\` desfasados.
> - Los recuentos de \`yarn audit\` son por aviso (un mismo paquete puede acumular varios GHSA del mismo rango); \`npm\`/\`pnpm\` los agrupan por paquete. Por eso el total de filas difiere entre proyectos.
> - En \`pnpm audit\`, "prod" incluye todo lo que cuelga de \`expo\` (su CLI viaja como dependencia de producción), de ahí que las apps móviles sumen muchos hallazgos de build.

${nodeSection(data.node)}
${outdatedSection(data.node)}
${pythonSection(data.python)}
${rustSection(data.rust)}
${crossMapSection(data.node, data.python, data.rust)}
${actionsSection(data.node)}

## 7. Prioridades sugeridas

### Fase 1 — parches de seguridad de bajo riesgo

- **\`backend\`**: subir \`@nestjs/platform-express\` a **11.2.8** (arrastra express/multer/body-parser/proxy-addr parcheados), \`@nestjs/swagger\` a **11.4.8**, \`compression\` a **1.8.2** y \`socket.io\` a **4.8.4**. Esto resuelve las críticas/altas de prod de express, multer, proxy-addr, body-parser y engine.io.
- **\`Interface web client\`**: \`react-router\` a **7.14.2** y \`axios\` a **1.20.0**. \`maplibre-gl\` exige salto major (4.7.1 → 6.4.1+) por el XSS del sanitizer: tratarlo como cambio planificado, no como parche.
- **\`Interface web delivery admin\`**: mismo caso de \`maplibre-gl\`.
- **Móviles**: \`shell-quote\`/\`node-forge\`/\`source-map-js\`/\`zod\`/\`compression\` entran por el CLI de Expo y \`react-native\`; se resuelven subiendo el SDK de Expo (57 → 58) y/o \`react-native\`, no con overrides aislados.
- **Python**: \`pytest\` 9.0.1 tiene un fallo moderado (tmpdir); subir a **9.2.0** en \`bot/requirements-dev.txt\`.
- **Rust**: \`rsa\` 0.9.10 (transitivo, RUSTSEC-2023-0071) no tiene versión corregida; no es explotable directamente en \`backend-tracking\` salvo que se firme/verifique RSA con entrada atacante.

### Fase 2 — higiene del árbol de dependencias

- **\`backend\`: mover a \`devDependencies\`** lo que hoy está en \`dependencies\` y solo se usa en build/test: \`@nestjs/cli\`, \`drizzle-kit\`, \`ts-node\`, \`tsconfig-paths\` y todos los \`@types/*\`. Reduce el árbol de producción (hoy 46 deps prod) y los hallazgos marcados como prod.
- **\`@imgly/background-removal-node\`** arrastra \`sharp\` 0.32.6, \`zod\` 3.21.4 y \`lodash\` 4.17.23 vulnerables y no publica versión con esas deps al día. Evaluar reemplazo o aislarlo en un servicio/proceso aparte.
- **Locks**: un solo lock por proyecto (pnpm en SPAs y móviles, yarn en backend, npm en desktop/e2e). Ya no quedan locks duplicados.
- **\`Interface web picking/\`** solo tiene \`node_modules\` sin manifiesto: borrar el directorio.

### Fase 3 — saltos major (planificar)

- \`backend\`: NestJS 11 → 12 (\`@nestjs/*\`), TypeScript 5.9 → 7, \`dotenv\` 17 → 18, \`nest-winston\` 1 → 2, \`@testcontainers/postgresql\` 10 → 12.
- \`Interface web client\`: React 18 → 19, MUI 7 → 9, \`react-router\` 7 → 8, \`maplibre-gl\` 4 → 6, Vite 6 → 8, \`recharts\` 2 → 3, \`date-fns\` 3 → 4.
- \`Interface web client\`: React 18 → 19, MUI 7 → 9, \`react-router\` 7 → 8, \`maplibre-gl\` 4 → 6, Vite 6 → 8, \`recharts\` 2 → 3, \`date-fns\` 3 → 4.
- SPAs admin: TypeScript 5 → 7 y \`@types/node\` 22 → 26.
- Móviles: Expo SDK 57 → 58 (arrastra todo el ecosistema \`expo-*\`), \`@react-native-async-storage\` 2 → 3, \`google-signin\` 16 → 17, TypeScript 6 → 7.

### Verificación después de cada tanda

\`yarn audit\` (backend), \`pnpm audit\` (SPAs/móviles), \`npm audit\` (desktop/e2e), más build y tests. Para Rust: \`cargo install cargo-audit && cargo audit\`; para Python: \`pip install pip-audit && pip-audit -r bot/requirements.txt\`.

---

_Informe reproducible: \`node scripts-agent/dependency-audit.mjs\`. Datos crudos en \`scripts-agent/out/dependency-audit.json\`._
`;
}

async function main() {
  console.log('Auditando proyectos Node…');
  const node = [];
  for (const p of NODE_PROJECTS) {
    process.stdout.write(`  - ${p.dir} (${p.pm})… `);
    const r = await auditNode(p);
    if (!r) {
      console.log('sin package.json');
      continue;
    }
    node.push(r);
    const c = countBySeverity(r.vulns);
    console.log(`${r.vulns.length} vulns (${c.critical}C/${c.high}A/${c.moderate}M/${c.low}B), ${r.outdated.length} desactualizadas`);
  }

  console.log('Auditando Python (OSV)…');
  const python = await auditPython();
  console.log(`  - ${python.vulns.length} vulnerabilidades`);

  console.log('Auditando Rust (OSV)…');
  const rust = await auditRust();
  console.log(`  - ${rust.vulns.length} vulnerabilidades sobre ${rust.lockedCount} crates`);

  const data = { generatedAt: new Date().toISOString(), node, python, rust };
  await mkdir(path.dirname(OUT_JSON), { recursive: true });
  await mkdir(path.dirname(OUT_MD), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(data, null, 2));
  await writeFile(OUT_MD, buildMarkdown(data));

  console.log(`\nInforme: ${OUT_MD}`);
  console.log(`Datos:   ${OUT_JSON}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
