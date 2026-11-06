# Auditoría de dependencias — Mercaldas ecommerce

Generado: 2026-11-06 · Herramientas: npm audit, pnpm audit, OSV.dev (Python/Rust), registros npm/PyPI/crates.io.

## Resumen ejecutivo

- **12 proyectos Node** auditados con su gestor real (`npm`, `pnpm` o `yarn`).
- **42 hallazgos** de vulnerabilidad en Node (0 críticas, 13 altas, 28 medias, 1 bajas).
- **27** de esos hallazgos afectan a dependencias de **producción**; el resto son de desarrollo/build.
- **96** dependencias directas Node tienen versión más nueva.
- Python: **0** hallazgos OSV. Rust: **1** hallazgos OSV.
- `Interface web picking/` contiene solo `node_modules` (sin `package.json` ni lock): instalación huérfana, no auditable.

> Notas de alcance:
>
> - `backend` se audita con **yarn**, que es el gestor del Dockerfile y del CI (`yarn install --frozen-lockfile`). Se eliminó su `package-lock.json` obsoleto (contenía paquetes que no existen en `yarn.lock`).
> - Las SPAs web usan **pnpm** en Docker y en el job E2E del CI (`pnpm-lock.yaml`); se eliminaron los `package-lock.json` desfasados.
> - Los recuentos de `yarn audit` son por aviso (un mismo paquete puede acumular varios GHSA del mismo rango); `npm`/`pnpm` los agrupan por paquete. Por eso el total de filas difiere entre proyectos.
> - En `pnpm audit`, "prod" incluye todo lo que cuelga de `expo` (su CLI viaja como dependencia de producción), de ahí que las apps móviles sumen muchos hallazgos de build.

## 1. Proyectos Node.js / TypeScript

| Proyecto | Gestor | Deps prod | Deps dev | Críticas | Altas | Medias | Bajas | Total | En prod |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `backend` | yarn | 46 | 32 | 0 | 13 | 7 | 1 | 21 | 21 |
| `e2e` | npm | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Interface desktop admin` | npm | 0 | 3 | 0 | 0 | 5 | 0 | 5 | 0 |
| `Interface desktop delivery admin` | npm | 0 | 3 | 0 | 0 | 5 | 0 | 5 | 0 |
| `Interface desktop picking admin` | npm | 0 | 3 | 0 | 0 | 5 | 0 | 5 | 0 |
| `Interface web client` | pnpm | 61 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Interface web admin` | pnpm | 7 | 9 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Interface web delivery admin` | pnpm | 5 | 9 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Interface web picking admin` | pnpm | 3 | 8 | 0 | 0 | 0 | 0 | 0 | 0 |
| `Interface movil client` | pnpm | 26 | 3 | 0 | 0 | 2 | 0 | 2 | 2 |
| `Interface movil delivery` | pnpm | 26 | 3 | 0 | 0 | 2 | 0 | 2 | 2 |
| `Interface movil picking` | pnpm | 22 | 3 | 0 | 0 | 2 | 0 | 2 | 2 |
| **TOTAL** | | | | **0** | **13** | **28** | **1** | **42** | |

### backend

| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |
|---|---|---|---|---|---|---|---|
| `brace-expansion` | high | prod | `<1.1.17` (inst. 1.1.16) | no | `@eslint/eslintrc`, `@nestjs/cli`, `exceljs` | >=1.1.17 | [brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg) |
| `brace-expansion` | high | prod | `<1.1.18` (inst. 1.1.16) | no | `@eslint/eslintrc`, `@nestjs/cli`, `exceljs` | >=1.1.18 | [brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| `brace-expansion` | high | prod | `<1.1.20` (inst. 1.1.16) | no | `@eslint/eslintrc`, `@nestjs/cli`, `exceljs` | >=1.1.20 | [brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| `brace-expansion` | high | prod | `<1.1.19` (inst. 1.1.16) | no | `@eslint/eslintrc`, `@nestjs/cli`, `exceljs` | >=1.1.19 | [brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) |
| `brace-expansion` | high | prod | `>=4.0.0 <5.0.8` (inst. 5.0.7) | no | `nodemon`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | >=5.0.8 | [brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg) |
| `brace-expansion` | high | prod | `>=4.0.0 <5.0.9` (inst. 5.0.7) | no | `nodemon`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | >=5.0.9 | [brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| `brace-expansion` | high | prod | `>=4.0.0 <5.0.11` (inst. 5.0.7) | no | `nodemon`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | >=5.0.11 | [brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| `brace-expansion` | high | prod | `>=4.0.0 <5.0.10` (inst. 5.0.7) | no | `nodemon`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | >=5.0.10 | [brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) |
| `brace-expansion` | high | prod | `>=2.0.0 <2.1.3` (inst. 2.1.2) | no | `exceljs`, `@testcontainers/postgresql` | >=2.1.3 | [brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg) |
| `brace-expansion` | high | prod | `>=2.0.0 <2.1.4` (inst. 2.1.2) | no | `exceljs`, `@testcontainers/postgresql` | >=2.1.4 | [brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| `brace-expansion` | high | prod | `>=2.0.0 <2.1.6` (inst. 2.1.2) | no | `exceljs`, `@testcontainers/postgresql` | >=2.1.6 | [brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| `brace-expansion` | high | prod | `>=2.0.0 <2.1.5` (inst. 2.1.2) | no | `exceljs`, `@testcontainers/postgresql` | >=2.1.5 | [brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) |
| `zod` | high | prod | `<4.6.6` (inst. 3.25.76) | no | `@imgly/background-removal-node` | >=4.6.6 | [Zod can exhaust memory while validating oversized constrained collections](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| `brace-expansion` | moderate | prod | `<1.1.21` (inst. 1.1.16) | no | `@eslint/eslintrc`, `@nestjs/cli`, `exceljs` | >=1.1.21 | [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) |
| `glob` | moderate | prod | `>=9.0.0 <=14.0.1` (inst. 10.5.0, 13.0.6) | no | `@testcontainers/postgresql`, `@nestjs/cli` | >=14.0.2 | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `brace-expansion` | moderate | prod | `>=4.0.0 <5.0.12` (inst. 5.0.7) | no | `nodemon`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | >=5.0.12 | [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) |
| `esbuild` | moderate | prod | `<=0.24.2` (inst. 0.18.20) | no | `drizzle-kit` | >=0.25.0 | [esbuild enables any website to send any requests to the development server and read the response](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| `uuid` | moderate | prod | `<11.1.1` (inst. 8.3.2) | no | `exceljs` | >=11.1.1 | [uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| `brace-expansion` | moderate | prod | `>=2.0.0 <2.1.7` (inst. 2.1.2) | no | `exceljs`, `@testcontainers/postgresql` | >=2.1.7 | [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) |
| `minimatch` | moderate | prod | `>=7.0.0 <11.0.1` (inst. 9.0.9, 10.2.5, 10.2.6) | no | `@testcontainers/postgresql`, `nodemon`, `@typescript-eslint/parser` | >=11.0.1 | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |
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
| `glob` | moderate | prod | `>=9.0.0 <=14.0.1` | no | `expo` | >=14.0.2 | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `minimatch` | moderate | prod | `>=7.0.0 <11.0.1` | no | `expo` | >=11.0.1 | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

### Interface movil delivery

| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |
|---|---|---|---|---|---|---|---|
| `glob` | moderate | prod | `>=9.0.0 <=14.0.1` | no | `expo` | >=14.0.2 | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `minimatch` | moderate | prod | `>=7.0.0 <11.0.1` | no | `expo` | >=11.0.1 | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

### Interface movil picking

| Paquete | Severidad | Alcance | Rango vulnerable | Directa | Vía | Corrección | Aviso |
|---|---|---|---|---|---|---|---|
| `glob` | moderate | prod | `>=9.0.0 <=14.0.1` | no | `expo` | >=14.0.2 | [Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| `minimatch` | moderate | prod | `>=7.0.0 <11.0.1` | no | `expo` | >=11.0.1 | [minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

## 2. Dependencias directas desactualizadas (Node)

Total de dependencias directas con versión más nueva: **96** (major: **74**, minor: **19**, patch: **3**).

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
| `fast-uri` | 3.1.9 | 4.2.3 | resolutionDependencies | major |
| `js-yaml` | 4.3.2 | 5.5.0 | resolutionDependencies | major |
| `typescript` | 5.9.3 | 7.0.2 | devDependencies | major |
| `zod` | 3.25.76 | 4.6.7 | resolutionDependencies | major |

### Interface web client

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `@mui/icons-material` | 7.3.5 | 9.5.0 | dependencies | major |
| `@mui/material` | 7.3.5 | 9.5.0 | dependencies | major |
| `date-fns` | 3.6.0 | 4.4.0 | dependencies | major |
| `lucide-react` | 0.487.0 | 1.70.0 | dependencies | major |
| `motion` | 12.23.24 | 14.10.1 | dependencies | major |
| `react-day-picker` | 8.10.1 | 10.0.2 | dependencies | major |
| `react-resizable-panels` | 2.1.7 | 4.19.1 | dependencies | major |
| `react-router` | 7.18.5 | 8.5.1 | dependencies | major |
| `recharts` | 2.15.2 | 3.10.1 | dependencies | major |

### Interface web admin

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `typescript` | 5.9.3 | 7.0.2 | devDependencies | major |

### Interface web delivery admin

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `typescript` | 5.9.3 | 7.0.2 | devDependencies | major |

### Interface web picking admin

| Paquete | Actual | Latest | Tipo | Salto |
|---|---|---|---|---|
| `typescript` | 5.9.3 | 7.0.2 | devDependencies | major |

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
| `tower-http` | `0.7` | `0.7.1` |
| `tracing-subscriber` | `0.3` | `0.3.23` |
| `uuid` | `1` | `1.29.0` |

## 5. Mapa cruzado por paquete

11 paquetes distintos concentran los hallazgos. Los que aparecen en más proyectos son los de mayor retorno si se corrigen en bloque.

| Paquete | Severidad máx. | Proyectos afectados | Corrección |
|---|---|---:|---|
| `brace-expansion` | high | 1 | >=2.1.5 |
| `zod` | high | 1 | >=4.6.6 |
| `glob` | moderate | 7 | >=14.0.2 |
| `minimatch` | moderate | 7 | >=11.0.1 |
| `@electron/asar` | moderate | 3 | @electron/packager@18.4.4 (major) |
| `@electron/packager` | moderate | 3 | @electron/packager@18.4.4 (major) |
| `@electron/universal` | moderate | 3 | @electron/packager@18.4.4 (major) |
| `esbuild` | moderate | 1 | >=0.25.0 |
| `uuid` | moderate | 1 | >=11.1.1 |
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
| `zod` | 3.25.76 | high | prod | @imgly/background-removal-node | >=4.6.6 |


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
- **Locks**: un solo lock por proyecto (pnpm en SPAs y móviles, yarn en backend, npm en desktop/e2e). Ya no quedan locks duplicados.
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
