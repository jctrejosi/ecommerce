# Auditoría de dependencias — Mercaldas ecommerce

Generado: 2026-11-06 · Herramientas: npm audit, pnpm audit, OSV.dev (Python/Rust), registros npm/PyPI/crates.io.

## Resumen ejecutivo

- **12 proyectos Node** auditados con su gestor real (`npm`, `pnpm` o `yarn`).
- **71 hallazgos** de vulnerabilidad en Node (0 críticas, 25 altas, 43 medias, 3 bajas).
- **40** de esos hallazgos afectan a dependencias de **producción**; el resto son de desarrollo/build.
- **113** dependencias directas Node tienen versión más nueva.
- Python: **0** hallazgos OSV. Rust: **1** hallazgos OSV.
- `Interface web picking/` contiene solo `node_modules` (sin `package.json` ni lock): instalación huérfana, no auditable.

> Notas de alcance:
>
> - `backend` se audita con **yarn**, que es el gestor del Dockerfile y del CI (`yarn install --frozen-lockfile`). Su `package-lock.json` está **obsoleto**: contiene `jest` y `handlebars` que no existen en `yarn.lock` ni en `node_modules`. Debe eliminarse para no auditar un árbol fantasma.
> - Las SPAs web se **construyen con pnpm** (`pnpm install --frozen-lockfile` en `docker/Dockerfile`) pero el job E2E del CI las instala con **npm ci** y su `package-lock.json`; los locks duplicados pueden resolver árboles distintos.
> - Los recuentos de `yarn audit` son por aviso (un mismo paquete puede acumular varios GHSA del mismo rango); `npm`/`pnpm` los agrupan por paquete. Por eso el total de filas difiere entre proyectos.
> - En `pnpm audit`, "prod" incluye todo lo que cuelga de `expo` (su CLI viaja como dependencia de producción), de ahí que las apps móviles sumen muchos hallazgos de build.

## 1. Proyectos Node.js / TypeScript

| Proyecto | Gestor | Deps prod | Deps dev | Críticas | Altas | Medias | Bajas | Total | En prod |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `backend` | yarn | 46 | 32 | 0 | 23 | 17 | 3 | 43 | 27 |
| `e2e` | npm | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Interface desktop admin` | npm | 0 | 3 | 0 | 0 | 5 | 0 | 5 | 0 |
| `Interface desktop delivery admin` | npm | 0 | 3 | 0 | 0 | 5 | 0 | 5 | 0 |
| `Interface desktop picking admin` | npm | 0 | 3 | 0 | 0 | 5 | 0 | 5 | 0 |
| `Interface web client` | pnpm | 61 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Interface web admin` | pnpm | 7 | 9 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Interface web delivery admin` | pnpm | 5 | 9 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Interface web picking admin` | pnpm | 3 | 8 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Interface movil client` | pnpm | 26 | 3 | 0 | 1 | 4 | 0 | 5 | 5 |
| `Interface movil delivery` | pnpm | 26 | 3 | 0 | 0 | 3 | 0 | 3 | 3 |
| `Interface movil picking` | pnpm | 22 | 3 | 0 | 1 | 4 | 0 | 5 | 5 |
| **TOTAL** | | | | **0** | **25** | **43** | **3** | **71** | |

### backend

| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |
|---|---|---|---|---|---|---|---|
| `undici` | high | dev | `<6.24.0` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.24.0 | [Undici has Unhandled Exception in WebSocket Client Due to Invalid server_max_window_bits Validation](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8) |
| `@fastify/busboy` | high | dev | `>=1.0.0 <3.2.1` (inst. 2.1.1) | no | `@testcontainers/postgresql` | >=3.2.1 | [@fastify/busboy vulnerable to Denial of Service via prototype-named multipart part header](https://github.com/advisories/GHSA-x8mw-p69m-v3mx) |
| `undici` | high | dev | `>=4.0.0 <6.29.1` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.29.1 | [undici vulnerable to TLS certificate validation bypass via dropped tls options in Agent](https://github.com/advisories/GHSA-2m5v-pch6-74hx) |
| `undici` | high | dev | `>=4.2.1 <6.29.1` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.29.1 | [undici vulnerable to Denial of Service via TLS 1.2 certificate-changing renegotiation](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm) |
| `undici` | high | dev | `<6.27.0` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.27.0 | [undici WebSocket client vulnerable to denial of service via fragment count bypass](https://github.com/advisories/GHSA-vxpw-j846-p89q) |
| `brace-expansion` | high | prod | `<1.1.17` (inst. 1.1.16) | no | `@eslint/eslintrc`, `@nestjs/cli`, `exceljs` | >=1.1.17 | [brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg) |
| `brace-expansion` | high | prod | `<1.1.18` (inst. 1.1.16) | no | `@eslint/eslintrc`, `@nestjs/cli`, `exceljs` | >=1.1.18 | [brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| `brace-expansion` | high | prod | `<1.1.20` (inst. 1.1.16) | no | `@eslint/eslintrc`, `@nestjs/cli`, `exceljs` | >=1.1.20 | [brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| `brace-expansion` | high | prod | `<1.1.19` (inst. 1.1.16) | no | `@eslint/eslintrc`, `@nestjs/cli`, `exceljs` | >=1.1.19 | [brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) |
| `brace-expansion` | high | prod | `>=4.0.0 <5.0.8` (inst. 5.0.7) | no | `nodemon`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | >=5.0.8 | [brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg) |
| `brace-expansion` | high | prod | `>=4.0.0 <5.0.9` (inst. 5.0.7) | no | `nodemon`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | >=5.0.9 | [brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| `brace-expansion` | high | prod | `>=4.0.0 <5.0.11` (inst. 5.0.7) | no | `nodemon`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | >=5.0.11 | [brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| `brace-expansion` | high | prod | `>=4.0.0 <5.0.10` (inst. 5.0.7) | no | `nodemon`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | >=5.0.10 | [brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) |
| `js-yaml` | high | prod | `>=4.0.0 <4.3.1` (inst. 4.3.0) | no | `@nestjs/cli` | >=4.3.1 | [JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) |
| `js-yaml` | high | prod | `>=4.0.0 <4.3.2` (inst. 4.3.0) | no | `@nestjs/cli` | >=4.3.2 | [js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources](https://github.com/advisories/GHSA-2883-xcg3-v3hh) |
| `zod` | high | prod | `<4.6.6` (inst. 3.21.4) | no | `@imgly/background-removal-node` | >=4.6.6 | [Zod can exhaust memory while validating oversized constrained collections](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| `sharp` | high | prod | `<0.35.0` (inst. 0.32.6) | no | `@imgly/background-removal-node` | >=0.35.0 | [sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) |
| `sharp` | high | prod | `<0.35.4` (inst. 0.32.6) | no | `@imgly/background-removal-node` | >=0.35.4 | [sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) |
| `sharp` | high | prod | `<0.35.5` (inst. 0.32.6) | no | `@imgly/background-removal-node` | >=0.35.5 | [sharp : Vulnerability in librsvg dependency CVE-2026-96889](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) |
| `brace-expansion` | high | prod | `>=2.0.0 <2.1.3` (inst. 2.1.2) | no | `exceljs`, `@testcontainers/postgresql` | >=2.1.3 | [brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg) |
| `brace-expansion` | high | prod | `>=2.0.0 <2.1.4` (inst. 2.1.2) | no | `exceljs`, `@testcontainers/postgresql` | >=2.1.4 | [brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| `brace-expansion` | high | prod | `>=2.0.0 <2.1.6` (inst. 2.1.2) | no | `exceljs`, `@testcontainers/postgresql` | >=2.1.6 | [brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| `brace-expansion` | high | prod | `>=2.0.0 <2.1.5` (inst. 2.1.2) | no | `exceljs`, `@testcontainers/postgresql` | >=2.1.5 | [brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) |
| `undici` | moderate | dev | `<6.23.0` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.23.0 | [Undici has an unbounded decompression chain in HTTP responses on Node.js Fetch API via Content-Encoding leads to resource exhaustion](https://github.com/advisories/GHSA-g9mf-h72j-4rw9) |
| `undici` | moderate | dev | `<6.24.0` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.24.0 | [Undici has CRLF Injection in undici via `upgrade` option](https://github.com/advisories/GHSA-4992-7rv2-5pvq) |
| `uuid` | moderate | prod | `<11.1.1` (inst. 10.0.0, 8.3.2) | no | `@testcontainers/postgresql`, `exceljs` | >=11.1.1 | [uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| `undici` | moderate | dev | `<6.27.0` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.27.0 | [undici vulnerable to HTTP header injection via Set-Cookie percent-decoding](https://github.com/advisories/GHSA-p88m-4jfj-68fv) |
| `undici` | moderate | dev | `<6.28.0` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.28.0 | [undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) |
| `@fastify/busboy` | moderate | dev | `<3.2.2` (inst. 2.1.1) | no | `@testcontainers/postgresql` | >=3.2.2 | [@fastify/busboy vulnerable to CRLF injection via multipart Content-Disposition filename and name](https://github.com/advisories/GHSA-gxm5-99cw-xjw9) |
| `undici` | moderate | dev | `>=5.15.0 <6.29.1` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.29.1 | [undici WebSocket client vulnerable to Denial of Service via unbounded automatic PONG buffering](https://github.com/advisories/GHSA-9fm3-97px-rjf6) |
| `brace-expansion` | moderate | prod | `<1.1.21` (inst. 1.1.16) | no | `@eslint/eslintrc`, `@nestjs/cli`, `exceljs` | >=1.1.21 | [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) |
| `glob` | moderate | prod | `>=9.0.0 <=14.0.1` (inst. 10.5.0, 13.0.6) | no | `@testcontainers/postgresql`, `@nestjs/cli` | >=14.0.2 | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `brace-expansion` | moderate | prod | `>=4.0.0 <5.0.12` (inst. 5.0.7) | no | `nodemon`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | >=5.0.12 | [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) |
| `qs` | moderate | dev | `>=6.14.2 <=6.15.3` (inst. 6.15.3) | no | `supertest` | >=6.16.0 | [qs array-limit bypass via bracket-key comma parsing](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) |
| `qs` | moderate | dev | `>=2.2.5 <6.16.0` (inst. 6.15.3) | no | `supertest` | >=6.16.0 | [qs: Denial of Service via Attacker Controlled isBuffer](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) |
| `qs` | moderate | dev | `>=6.7.0 <=6.16.0` (inst. 6.15.3) | no | `supertest` | >=6.16.1 | [qs : qs.stringify with arrayFormat 'comma' throws an uncaught TypeError on array elements carrying a non-callable own toString (DoS)](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) |
| `zod` | moderate | prod | `<=3.22.2` (inst. 3.21.4) | no | `@imgly/background-removal-node` | >=3.22.3 | [Zod denial of service vulnerability](https://github.com/advisories/GHSA-m95q-7qp3-xv42) |
| `esbuild` | moderate | prod | `<=0.24.2` (inst. 0.18.20) | no | `drizzle-kit` | >=0.25.0 | [esbuild enables any website to send any requests to the development server and read the response](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| `brace-expansion` | moderate | prod | `>=2.0.0 <2.1.7` (inst. 2.1.2) | no | `exceljs`, `@testcontainers/postgresql` | >=2.1.7 | [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) |
| `minimatch` | moderate | prod | `>=7.0.0 <11.0.1` (inst. 9.0.9, 10.2.5, 10.2.6) | no | `@testcontainers/postgresql`, `nodemon`, `@typescript-eslint/parser` | >=11.0.1 | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |
| `undici` | low | dev | `<6.27.0` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.27.0 | [undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse](https://github.com/advisories/GHSA-35p6-xmwp-9g52) |
| `undici` | low | dev | `<6.28.1` (inst. 5.29.0) | no | `@testcontainers/postgresql` | >=6.28.1 | [undici vulnerable to downstream response splitting via retry interceptor](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) |
| `deepmerge` | low | prod | `>=4.2.0 <=4.3.1` (inst. 4.3.1) | no | `@nestjs/cli` | no | [deepmerge mergeObject() allows prototype poisoning of returned objects](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) |

### e2e

Sin vulnerabilidades conocidas.

### Interface desktop admin

| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |
|---|---|---|---|---|---|---|---|
| `@electron/asar` | moderate | dev | `>=4.0.0` | no | — | @electron/packager@18.4.4 (major) |  |
| `@electron/packager` | moderate | dev | `>=19.0.0` | sí | directa | @electron/packager@18.4.4 (major) |  |
| `@electron/universal` | moderate | dev | `>=3.0.0` | no | — | @electron/packager@18.4.4 (major) |  |
| `glob` | moderate | dev | `9.0.0 - 14.0.1` | no | — | @electron/packager@18.4.4 (major) | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `minimatch` | moderate | dev | `7.0.0 - 11.0.0` | no | — | @electron/packager@18.4.4 (major) | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

### Interface desktop delivery admin

| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |
|---|---|---|---|---|---|---|---|
| `@electron/asar` | moderate | dev | `>=4.0.0` | no | — | @electron/packager@18.4.4 (major) |  |
| `@electron/packager` | moderate | dev | `>=19.0.0` | sí | directa | @electron/packager@18.4.4 (major) |  |
| `@electron/universal` | moderate | dev | `>=3.0.0` | no | — | @electron/packager@18.4.4 (major) |  |
| `glob` | moderate | dev | `9.0.0 - 14.0.1` | no | — | @electron/packager@18.4.4 (major) | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `minimatch` | moderate | dev | `7.0.0 - 11.0.0` | no | — | @electron/packager@18.4.4 (major) | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

### Interface desktop picking admin

| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |
|---|---|---|---|---|---|---|---|
| `@electron/asar` | moderate | dev | `>=4.0.0` | no | — | @electron/packager@18.4.4 (major) |  |
| `@electron/packager` | moderate | dev | `>=19.0.0` | sí | directa | @electron/packager@18.4.4 (major) |  |
| `@electron/universal` | moderate | dev | `>=3.0.0` | no | — | @electron/packager@18.4.4 (major) |  |
| `glob` | moderate | dev | `9.0.0 - 14.0.1` | no | — | @electron/packager@18.4.4 (major) | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `minimatch` | moderate | dev | `7.0.0 - 11.0.0` | no | — | @electron/packager@18.4.4 (major) | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

### Interface web client

Sin vulnerabilidades conocidas.

### Interface web admin

Sin vulnerabilidades conocidas.

### Interface web delivery admin

Sin vulnerabilidades conocidas.

### Interface web picking admin

Sin vulnerabilidades conocidas.

### Interface movil client

| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |
|---|---|---|---|---|---|---|---|
| `node-forge` | high | prod | `<=1.4.0` | no | `expo` | no | [node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements](https://github.com/advisories/GHSA-86w9-cpqp-85rv) |
| `decode-uri-component` | moderate | prod | `<=0.4.2` | no | `expo-router` | >=0.5.0 | [decode-uri-component: Denial of service via exponential decoding of malformed percent-encoded input](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) |
| `brace-expansion` | moderate | prod | `>=4.0.0 <5.0.12` | no | `expo` | >=5.0.12 | [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) |
| `glob` | moderate | prod | `>=9.0.0 <=14.0.1` | no | `expo` | >=14.0.2 | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `minimatch` | moderate | prod | `>=7.0.0 <11.0.1` | no | `expo` | >=11.0.1 | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

### Interface movil delivery

| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |
|---|---|---|---|---|---|---|---|
| `decode-uri-component` | moderate | prod | `<=0.4.2` | no | `expo-router` | >=0.5.0 | [decode-uri-component: Denial of service via exponential decoding of malformed percent-encoded input](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) |
| `glob` | moderate | prod | `>=9.0.0 <=14.0.1` | no | `expo` | >=14.0.2 | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `minimatch` | moderate | prod | `>=7.0.0 <11.0.1` | no | `expo` | >=11.0.1 | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

### Interface movil picking

| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |
|---|---|---|---|---|---|---|---|
| `node-forge` | high | prod | `<=1.4.0` | no | `expo` | no | [node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements](https://github.com/advisories/GHSA-86w9-cpqp-85rv) |
| `decode-uri-component` | moderate | prod | `<=0.4.2` | no | `expo-router` | >=0.5.0 | [decode-uri-component: Denial of service via exponential decoding of malformed percent-encoded input](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) |
| `brace-expansion` | moderate | prod | `>=4.0.0 <5.0.12` | no | `expo` | >=5.0.12 | [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) |
| `glob` | moderate | prod | `>=9.0.0 <=14.0.1` | no | `expo` | >=14.0.2 | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `minimatch` | moderate | prod | `>=7.0.0 <11.0.1` | no | `expo` | >=11.0.1 | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

## 2. Dependencias directas desactualizadas (Node)

Total de dependencias directas con versión más nueva: **113** (major: **83**, minor: **19**, patch: **11**).

### backend

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `@nestjs/cli` | 11.0.24 | 12.0.12 | dependencies | major |
| `@nestjs/common` | 11.1.28 | 12.4.0 | dependencies | major |
| `@nestjs/config` | 4.0.4 | 12.1.1 | dependencies | major |
| `@nestjs/core` | 11.1.28 | 12.4.0 | dependencies | major |
| `@nestjs/jwt` | 11.0.2 | 12.0.4 | dependencies | major |
| `@nestjs/passport` | 11.0.5 | 12.0.1 | dependencies | major |
| `@nestjs/platform-express` | 11.2.8 | 12.4.0 | dependencies | major |
| `@nestjs/platform-socket.io` | 11.1.28 | 12.4.0 | dependencies | major |
| `@nestjs/schedule` | 6.1.3 | 12.0.3 | dependencies | major |
| `@nestjs/schematics` | 11.1.0 | 12.0.13 | devDependencies | major |
| `@nestjs/swagger` | 11.4.8 | 12.1.1 | dependencies | major |
| `@nestjs/testing` | 11.1.28 | 12.4.0 | devDependencies | major |
| `@nestjs/websockets` | 11.1.28 | 12.4.0 | dependencies | major |
| `@testcontainers/postgresql` | 10.28.0 | 12.2.1 | devDependencies | major |
| `@types/supertest` | 6.0.0 | 7.2.1 | devDependencies | major |
| `dotenv` | 17.4.2 | 18.0.9 | dependencies | major |
| `fast-uri` | 3.1.9 | 4.2.3 | resolutionDependencies | major |
| `nest-winston` | 1.10.2 | 2.0.0 | dependencies | major |
| `typescript` | 5.9.3 | 7.0.2 | devDependencies | major |

### Interface web client

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `@mui/icons-material` | 7.3.5 | 9.5.0 | dependencies | major |
| `@mui/material` | 7.3.5 | 9.5.0 | dependencies | major |
| `@vitejs/plugin-react` | 4.7.0 | 6.2.1 | devDependencies | major |
| `date-fns` | 3.6.0 | 4.4.0 | dependencies | major |
| `lucide-react` | 0.487.0 | 1.70.0 | dependencies | major |
| `motion` | 12.23.24 | 14.10.1 | dependencies | major |
| `react` | 18.3.1 | 19.3.1 | dependencies | major |
| `react-day-picker` | 8.10.1 | 10.0.2 | dependencies | major |
| `react-dom` | 18.3.1 | 19.3.1 | dependencies | major |
| `react-resizable-panels` | 2.1.7 | 4.18.1 | dependencies | major |
| `react-router` | 7.18.5 | 8.5.1 | dependencies | major |
| `recharts` | 2.15.2 | 3.10.1 | dependencies | major |
| `vite` | 6.4.5 | 8.3.6 | devDependencies | major |
| `@tailwindcss/vite` | 4.3.4 | 4.3.5 | devDependencies | patch |
| `tailwindcss` | 4.3.4 | 4.3.5 | devDependencies | patch |

### Interface web admin

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `@types/node` | 22.20.1 | 26.6.6 | devDependencies | major |
| `typescript` | 5.9.3 | 7.0.2 | devDependencies | major |
| `@tailwindcss/vite` | 4.3.4 | 4.3.5 | devDependencies | patch |
| `tailwindcss` | 4.3.4 | 4.3.5 | devDependencies | patch |

### Interface web delivery admin

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `@types/node` | 22.20.1 | 26.6.6 | devDependencies | major |
| `typescript` | 5.9.3 | 7.0.2 | devDependencies | major |
| `@tailwindcss/vite` | 4.3.4 | 4.3.5 | devDependencies | patch |
| `tailwindcss` | 4.3.4 | 4.3.5 | devDependencies | patch |

### Interface web picking admin

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `@types/node` | 22.20.1 | 26.6.6 | devDependencies | major |
| `typescript` | 5.9.3 | 7.0.2 | devDependencies | major |
| `@tailwindcss/vite` | 4.3.4 | 4.3.5 | devDependencies | patch |
| `tailwindcss` | 4.3.4 | 4.3.5 | devDependencies | patch |

### Interface movil client

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `@react-native-async-storage/async-storage` | 2.2.0 | 3.1.1 | dependencies | major |
| `@react-native-google-signin/google-signin` | 16.1.5 | 17.0.0 | dependencies | major |
| `@types/node` | 22.20.2 | 26.6.6 | devDependencies | major |
| `expo` | 57.0.32 | 58.0.23 | dependencies | major |
| `expo-build-properties` | 57.0.23 | 58.0.12 | dependencies | major |
| `expo-constants` | 57.0.23 | 58.0.15 | dependencies | major |
| `expo-device` | 57.0.2 | 58.0.5 | dependencies | major |
| `expo-font` | 57.0.4 | 58.0.11 | dependencies | major |
| `expo-linear-gradient` | 57.0.2 | 58.0.3 | dependencies | major |
| `expo-linking` | 57.0.13 | 58.0.16 | dependencies | major |
| `expo-network` | 57.0.3 | 58.0.4 | dependencies | major |
| `expo-notifications` | 57.0.25 | 58.1.8 | dependencies | major |
| `expo-router` | 57.0.30 | 58.0.30 | dependencies | major |
| `expo-secure-store` | 57.0.4 | 58.0.2 | dependencies | major |
| `expo-status-bar` | 57.0.1 | 58.0.4 | dependencies | major |
| `react-native-webview` | 13.16.1 | 14.0.1 | dependencies | major |
| `typescript` | 6.0.3 | 7.0.2 | devDependencies | major |
| `@types/react` | 19.2.18 | 19.3.0 | devDependencies | minor |
| `react` | 19.2.3 | 19.3.1 | dependencies | minor |
| `react-dom` | 19.2.3 | 19.3.1 | dependencies | minor |
| `react-native` | 0.86.3 | 0.88.1 | dependencies | minor |
| `react-native-safe-area-context` | 5.7.0 | 5.11.1 | dependencies | minor |
| `react-native-screens` | 4.26.2 | 4.30.1 | dependencies | minor |
| `react-native-web` | 0.21.2 | 0.21.4 | dependencies | patch |

### Interface movil delivery

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `@react-native-async-storage/async-storage` | 2.2.0 | 3.1.1 | dependencies | major |
| `@types/node` | 22.20.1 | 26.6.6 | devDependencies | major |
| `expo` | 57.0.32 | 58.0.23 | dependencies | major |
| `expo-audio` | 57.0.5 | 58.0.11 | dependencies | major |
| `expo-constants` | 57.0.17 | 58.0.15 | dependencies | major |
| `expo-device` | 57.0.1 | 58.0.5 | dependencies | major |
| `expo-image-picker` | 57.0.21 | 58.0.10 | dependencies | major |
| `expo-linking` | 57.0.13 | 58.0.16 | dependencies | major |
| `expo-location` | 57.0.23 | 58.0.20 | dependencies | major |
| `expo-notifications` | 57.0.25 | 58.1.8 | dependencies | major |
| `expo-router` | 57.0.30 | 58.0.30 | dependencies | major |
| `expo-secure-store` | 57.0.3 | 58.0.2 | dependencies | major |
| `expo-status-bar` | 57.0.1 | 58.0.4 | dependencies | major |
| `expo-task-manager` | 57.0.22 | 58.0.13 | dependencies | major |
| `typescript` | 6.0.3 | 7.0.2 | devDependencies | major |
| `@maplibre/maplibre-react-native` | 11.3.10 | 11.5.1 | dependencies | minor |
| `@types/react` | 19.2.18 | 19.3.0 | devDependencies | minor |
| `react` | 19.2.3 | 19.3.1 | dependencies | minor |
| `react-dom` | 19.2.3 | 19.3.1 | dependencies | minor |
| `react-native` | 0.86.3 | 0.88.1 | dependencies | minor |
| `react-native-safe-area-context` | 5.7.0 | 5.11.1 | dependencies | minor |
| `react-native-screens` | 4.26.2 | 4.30.1 | dependencies | minor |
| `react-native-web` | 0.21.2 | 0.21.4 | dependencies | patch |

### Interface movil picking

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `@react-native-async-storage/async-storage` | 2.2.0 | 3.1.1 | dependencies | major |
| `@types/node` | 22.20.1 | 26.6.6 | devDependencies | major |
| `expo` | 57.0.32 | 58.0.23 | dependencies | major |
| `expo-audio` | 57.0.5 | 58.0.11 | dependencies | major |
| `expo-camera` | 57.0.6 | 58.0.14 | dependencies | major |
| `expo-constants` | 57.0.23 | 58.0.15 | dependencies | major |
| `expo-image-picker` | 57.0.21 | 58.0.10 | dependencies | major |
| `expo-linking` | 57.0.13 | 58.0.16 | dependencies | major |
| `expo-network` | 57.0.3 | 58.0.4 | dependencies | major |
| `expo-notifications` | 57.0.25 | 58.1.8 | dependencies | major |
| `expo-router` | 57.0.30 | 58.0.30 | dependencies | major |
| `expo-status-bar` | 57.0.1 | 58.0.4 | dependencies | major |
| `typescript` | 6.0.3 | 7.0.2 | devDependencies | major |
| `@types/react` | 19.2.18 | 19.3.0 | devDependencies | minor |
| `react` | 19.2.3 | 19.3.1 | dependencies | minor |
| `react-dom` | 19.2.3 | 19.3.1 | dependencies | minor |
| `react-native` | 0.86.3 | 0.88.1 | dependencies | minor |
| `react-native-safe-area-context` | 5.7.0 | 5.11.1 | dependencies | minor |
| `react-native-screens` | 4.26.2 | 4.30.1 | dependencies | minor |
| `react-native-web` | 0.21.2 | 0.21.4 | dependencies | patch |

## 3. Python (bot + test_db)

Vulnerabilidades OSV: **0** (críticas 0, altas 0, medias 0, bajas 0).

### Freshness

| Archivo | Paquete | Declarado | Última versión |
|---|---|---|---|
| bot/requirements.txt | `fastapi` | `==0.162.0` | `0.162.0` |
| bot/requirements.txt | `uvicorn` | `==0.54.0` | `0.54.0` |
| bot/requirements.txt | `python-dotenv` | `==1.2.4` | `1.2.4` |
| bot/requirements.txt | `asyncpg` | `==0.32.0` | `0.32.0` |
| bot/requirements.txt | `httpx` | `==0.28.1` | `0.28.1` |
| bot/requirements-dev.txt | `pytest` | `==9.2.0` | `9.2.0` |
| bot/requirements-dev.txt | `pytest-asyncio` | `==1.4.1.post1` | `1.4.1.post1` |
| bot/requirements-dev.txt | `pytest-cov` | `==7.1.0` | `7.1.0` |
| bot/requirements-dev.txt | `testcontainers` | `==4.15.0` | `4.15.0` |
| bot/requirements-dev.txt | `httpx` | `==0.28.1` | `0.28.1` |
| test_db/requirements.txt | `pyodbc` | `>=5.0` (sin pin) | `5.4.0` |
| test_db/requirements.txt | `fastapi` | `>=0.115` (sin pin) | `0.162.0` |
| test_db/requirements.txt | `uvicorn` | `>=0.30` (sin pin) | `0.54.0` |
| test_db/api/requirements.txt | `pyodbc` | `>=5.0` (sin pin) | `5.4.0` |
| test_db/api/requirements.txt | `fastapi` | `>=0.115` (sin pin) | `0.162.0` |
| test_db/api/requirements.txt | `uvicorn` | `>=0.30` (sin pin) | `0.54.0` |

## 4. Rust (`backend-tracking`)

Crates en `Cargo.lock`: **241**. Vulnerabilidades OSV: **1**.

| Crate | Versión | Severidad | Directa | IDs | Resumen |
|---|---|---|---|---|---|
| `rsa` | 0.9.10 | moderate (est.) | no | RUSTSEC-2023-0071 | Marvin Attack: potential key recovery through timing sidechannels |

### Freshness de dependencias directas

| Crate | Declarado | Última estable |
|---|---|---|
| `anyhow` | `1` | `1.0.104` |
| `axum` | `0.8` | `0.8.9` |
| `dotenvy` | `0.15` | `0.15.7` |
| `hex` | `0.4` | `0.4.3` |
| `serde_json` | `1` | `1.0.154` |
| `sha2` | `0.10` | `0.11.1` |
| `tracing` | `0.1` | `0.1.44` |
| `chrono` | `0.4` | `0.4.45` |
| `redis` | `0.27` | `1.8.1` |
| `serde` | `1` | `1.0.229` |
| `sqlx` | `0.8` | `0.9.0` |
| `tokio` | `1` | `1.54.1` |
| `tower-http` | `0.6` | `0.7.1` |
| `tracing-subscriber` | `0.3` | `0.3.23` |
| `uuid` | `1` | `1.29.0` |

## 5. Mapa cruzado por paquete

18 paquetes distintos concentran los hallazgos. Los que aparecen en más proyectos son los de mayor retorno si se corrigen en bloque.

| Paquete | Severidad máx. | Proyectos afectados | Corrección |
|---|---|---:|---|
| `brace-expansion` | high | 3 | >=5.0.12 |
| `node-forge` | high | 2 | no |
| `undici` | high | 1 | >=6.27.0 |
| `@fastify/busboy` | high | 1 | >=3.2.2 |
| `js-yaml` | high | 1 | >=4.3.2 |
| `zod` | high | 1 | >=4.6.6 |
| `sharp` | high | 1 | >=0.35.5 |
| `glob` | moderate | 7 | >=14.0.2 |
| `minimatch` | moderate | 7 | >=11.0.1 |
| `@electron/asar` | moderate | 3 | @electron/packager@18.4.4 (major) |
| `@electron/packager` | moderate | 3 | @electron/packager@18.4.4 (major) |
| `@electron/universal` | moderate | 3 | @electron/packager@18.4.4 (major) |
| `decode-uri-component` | moderate | 3 | >=0.5.0 |
| `uuid` | moderate | 1 | >=11.1.1 |
| `qs` | moderate | 1 | >=6.16.1 |
| `esbuild` | moderate | 1 | >=0.25.0 |
| `rsa` | moderate | 1 | ver Cargo.lock |
| `deepmerge` | low | 1 | no |

## 6. Acciones inmediatas (críticas y altas)

Cada fila indica el paquete vulnerable, la versión instalada y la **dependencia directa a subir** cuando el fallo es transitivo.

### backend

| Paquete vulnerable | Instalada | Severidad | Alcance | Subir | Corrección del paquete |
|---|---|---|---|---|---|
| `brace-expansion` | 1.1.16 | high | prod | @eslint/eslintrc, @nestjs/cli, exceljs | >=1.1.17 |
| `brace-expansion` | 5.0.7 | high | prod | nodemon, @typescript-eslint/parser, @typescript-eslint/eslint-plugin | >=5.0.8 |
| `brace-expansion` | 2.1.2 | high | prod | exceljs, @testcontainers/postgresql | >=2.1.3 |
| `js-yaml` | 4.3.0 | high | prod | @nestjs/cli | >=4.3.1 |
| `sharp` | 0.32.6 | high | prod | @imgly/background-removal-node | >=0.35.0 |
| `zod` | 3.21.4 | high | prod | @imgly/background-removal-node | >=4.6.6 |
| `@fastify/busboy` | 2.1.1 | high | dev | @testcontainers/postgresql | >=3.2.1 |
| `undici` | 5.29.0 | high | dev | @testcontainers/postgresql | >=6.24.0 |

### Interface movil client

| Paquete vulnerable | Instalada | Severidad | Alcance | Subir | Corrección del paquete |
|---|---|---|---|---|---|
| `node-forge` | — | high | prod | expo | no |

### Interface movil picking

| Paquete vulnerable | Instalada | Severidad | Alcance | Subir | Corrección del paquete |
|---|---|---|---|---|---|
| `node-forge` | — | high | prod | expo | no |


## 7. Prioridades sugeridas

### Fase 1 — parches de seguridad de bajo riesgo

- **`backend`**: subir `@nestjs/platform-express` a **11.2.8** (arrastra express/multer/body-parser/proxy-addr parcheados), `@nestjs/swagger` a **11.4.8**, `compression` a **1.8.2** y `socket.io` a **4.8.4**. Esto resuelve las críticas/altas de prod de express, multer, proxy-addr, body-parser y engine.io.
- **`Interface web client`**: `react-router` a **7.14.2** y `axios` a **1.20.0**. `maplibre-gl` exige salto major (4.7.1 → 6.4.1+) por el XSS del sanitizer: tratarlo como cambio planificado, no como parche.
- **`Interface web delivery admin`**: mismo caso de `maplibre-gl`.
- **Móviles**: `shell-quote`/`node-forge`/`source-map-js`/`zod`/`compression` entran por el CLI de Expo y `react-native`; se resuelven subiendo el SDK de Expo (57 → 58) y/o `react-native`, no con overrides aislados.
- **Python**: `pytest` 9.0.1 tiene un fallo moderado (tmpdir); subir a **9.2.0** en `bot/requirements-dev.txt`.
- **Rust**: `rsa` 0.9.10 (transitivo, RUSTSEC-2023-0071) no tiene versión corregida; no es explotable directamente en `backend-tracking` salvo que se firme/verifique RSA con entrada atacante.

### Fase 2 — higiene del árbol de dependencias

- **`backend`: mover a `devDependencies`** lo que hoy está en `dependencies` y solo se usa en build/test: `@nestjs/cli`, `drizzle-kit`, `ts-node`, `tsconfig-paths` y todos los `@types/*`. Reduce el árbol de producción (hoy 46 deps prod) y los hallazgos marcados como prod.
- **`@imgly/background-removal-node`** arrastra `sharp` 0.32.6, `zod` 3.21.4 y `lodash` 4.17.23 vulnerables y no publica versión con esas deps al día. Evaluar reemplazo o aislarlo en un servicio/proceso aparte.
- **Eliminar `backend/package-lock.json`** (obsoleto frente a `yarn.lock`) y **elegir un solo lock por SPA**: el Dockerfile usa `pnpm`, el CI E2E usa `npm ci`. Mientras convivan, la auditoría y el despliegue no miden lo mismo.
- **`Interface web picking/`** solo tiene `node_modules` sin manifiesto: borrar el directorio.

### Fase 3 — saltos major (planificar)

- `backend`: NestJS 11 → 12 (`@nestjs/*`), TypeScript 5.9 → 7, `dotenv` 17 → 18, `nest-winston` 1 → 2, `@testcontainers/postgresql` 10 → 12.
- `Interface web client`: React 18 → 19, MUI 7 → 9, `react-router` 7 → 8, `maplibre-gl` 4 → 6, Vite 6 → 8, `recharts` 2 → 3, `date-fns` 3 → 4.
- `Interface web client`: React 18 → 19, MUI 7 → 9, `react-router` 7 → 8, `maplibre-gl` 4 → 6, Vite 6 → 8, `recharts` 2 → 3, `date-fns` 3 → 4.
- SPAs admin: TypeScript 5 → 7 y `@types/node` 22 → 26.
- Móviles: Expo SDK 57 → 58 (arrastra todo el ecosistema `expo-*`), `@react-native-async-storage` 2 → 3, `google-signin` 16 → 17, TypeScript 6 → 7.

### Verificación después de cada tanda

`yarn audit` (backend), `pnpm audit` (SPAs/móviles), `npm audit` (desktop/e2e), más build y tests. Para Rust: `cargo install cargo-audit && cargo audit`; para Python: `pip install pip-audit && pip-audit -r bot/requirements.txt`.

---

_Informe reproducible: `node scripts-agent/dependency-audit.mjs`. Datos crudos en `scripts-agent/out/dependency-audit.json`._
