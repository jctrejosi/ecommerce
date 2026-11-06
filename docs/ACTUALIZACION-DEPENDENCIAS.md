# Actualización de dependencias — 2026-11-06

Rama `dev`. Se actualizaron dependencias **dentro de la misma major** (más los
parches de seguridad que exigían subir de minor), evitando los saltos major que
cambian APIs. Todo se compiló y se volvió a ejecutar; el detalle de
vulnerabilidades vigente está en `docs/DEPENDENCIA_AUDITORIA.md`.

## Qué se actualizó

| Proyecto | Gestor | Cambios principales |
|---|---|---|
| `backend` | yarn | NestJS `platform-express` 11.1.28 → **11.2.8** y `swagger` 11.4.5 → **11.4.8**; `compression` 1.8.2; `socket.io` 4.8.4; `pg` 8.23.1; `drizzle-orm` 0.45.4; `drizzle-kit` 0.31.11; `uuid` 14.0.3; `cloudinary` 2.11.0; `resend` 6.37.0; `eslint` 10.14.0; `prettier` 3.9.10; `@types/node` 26.6.6; `vite` 8.3.6 |
| `Interface web client` | pnpm | **react-router 7.13.0 → 7.18.5**, **axios 1.21.0**, **maplibre-gl 4.7.1 → 6.16.0**, 28 paquetes `@radix-ui/*`, `tailwindcss`/`@tailwindcss/vite` 4.3.4, `react-hook-form` 7.91.0, `sonner` 2.0.8, `vite` 6.4.5 |
| `Interface web admin` | pnpm | React 19.3.1, `recharts` 3.10.1, `lucide-react` 1.70.0, `vite` 8.3.6, `tailwindcss` 4.3.4, `@vitejs/plugin-react` 6.2.1, `oxfmt` 0.77.0 |
| `Interface web delivery admin` | pnpm | React 19.3.1, **maplibre-gl 4.7.1 → 6.16.0**, `vite` 8.3.6, `tailwindcss` 4.3.4, `lucide-react` 1.70.0 |
| `Interface web picking admin` | pnpm | React 19.3.1, `vite` 8.3.6, `tailwindcss` 4.3.4, `lucide-react` 1.70.0 |
| `Interface movil client/delivery/picking` | pnpm | Parches que recomienda Expo SDK 57 (`expo` 57.0.32, `expo-router` 57.0.30, etc.), `@tanstack/react-query` 5.106.1, `zustand` 5.1.0, `socket.io-client` 4.8.4, `axios` 1.21.0 |
| Desktop (3) y `e2e` | npm | Electron 45.2.3; `@playwright/test` 1.65.0 |
| `bot` | pip | `fastapi` 0.162.0, `uvicorn` 0.54.0, `asyncpg` 0.32.0, `python-dotenv` 1.2.4, `pytest` 9.2.0, `pytest-asyncio` 1.4.1.post1, `pytest-cov` 7.1.0, `testcontainers` 4.15.0 (y se eliminó el duplicado) |
| `backend-tracking` | cargo | `cargo update` (241 crates bloqueados) |

## Correcciones forzadas de transitivas

`yarn` no actualiza transitivas con `upgrade`, así que se usaron `resolutions`
en `backend/package.json`:

```
express ^5.3.0 · body-parser ^2.4.0 · proxy-addr ^2.0.8
multer ^2.5.0 · engine.io ^6.6.11 · fast-uri ^3.1.9 · lodash ^4.18.1
```

En las apps móviles (`pnpm.overrides`): `shell-quote ^1.11.0`,
`source-map-js ^1.2.2`, `compression ^1.8.2`.
En `Interface web client`: `browserslist ^4.28.7`.

## Resultado de seguridad

| Métrica | Antes | Después |
|---|---|---|
| Críticas (todo el monorepo) | 6 | **0** |
| Altas en `backend` | 35 | 23 |
| Vulnerabilidades `Interface web client` | 11 | **0** |
| Paneles web admin/delivery/picking | 4 / 3 / 2 | **0 / 0 / 0** |
| Python | 1 | **0** |

## Riesgos pendientes (no se tocaron a propósito)

- **`@imgly/background-removal-node`** (backend, runtime) fija `sharp ~0.32.4`,
  `zod ~3.21.4`: parchearlas exige saltos incompatibles. No hay versión nueva de
  imgly. Recomendación: aislarlo en un worker/servicio o reemplazarlo.
- **`brace-expansion`, `js-yaml` (vía `@nestjs/cli`), `undici`/`@fastify/busboy`
  (vía `@testcontainers`)**: DoS en herramientas de build/test, no en runtime.
  Se arreglarían moviendo `@nestjs/cli`, `drizzle-kit`, `ts-node`, `tsconfig-paths`
  y `@types/*` a `devDependencies`, y fijando resoluciones por línea de major.
- **`node-forge`** en apps móviles: el advisory no tiene versión corregida.
- **`@electron/packager`/`@electron/asar`** (desktop): el "fix" que propone npm es
  un downgrade a 18.4.4; no se aplicó.
- **Saltos major pendientes**: NestJS 11 → 12, React 18 → 19 y MUI 7 → 9
  (`web client`), TypeScript 5/6 → 7, Expo 57 → 58. No se ejecutaron porque
  cambian APIs y el objetivo era no perder funcionalidad.

## Validación ejecutada

- `backend`: `yarn build` OK y `yarn test:unit` → **530 tests OK**.
- SPAs (client/admin/delivery/picking): `pnpm build` OK.
- Móviles: `expo install --fix` + `pnpm typecheck` OK en las 3.
- `bot`: `pytest` → **257 tests OK**.
- `backend-tracking`: `cargo check --all-targets` OK.
- E2E con navegador real: `playwright test` → **29/29 OK**: client, admin,
  picking, delivery, **mapa** (`map`, WebGL/SwiftShader: canvas, pines,
  selección, arrastre y zoom) y smoke **5/5**.
- `npx tsc --noEmit` en `e2e` OK.
- Stack levantado con `node dev.js --webclient --admin --picking-admin
  --delivery-admin --bot --no-advantage`: backend `:3000` (Swagger 200),
  web client `:4173`, admin `:8443`, picking `:8446`, delivery `:8447` y bot
  `:8000/health` responden 200; sin errores nuevos en `logs/*.log`.

### Prueba del mapa (nueva)

`e2e/tests/map/delivery-map.spec.ts` (proyecto `map`) ejercita MapLibre de verdad
con WebGL habilitado por SwiftShader:

- el canvas se pinta (no cae al fallback de "WebGL desactivado");
- aparecen los pines de repartidor y destino, y al **seleccionar** el pin se
  añade el de la sucursal de recogida;
- el **arrastre** mueve la cámara y los pines;
- la **rueda** hace zoom y separa los pines.

El mapa corre aislado del resto (`npm run test:map`) porque SwiftShader es lento.
Los tiles y el estilo se sirven offline desde `mockApi.ts` (`blockMapTiles` +
`MOCK_DRIVER_ACTIVE`).

### Avisos preexistentes (no bloquean)

- `@nestjs/swagger`: DTOs duplicados (`CreateCampaignDto`, `UpdateCampaignDto`)
  con esquemas distintos. Hoy es warning; la próxima major lo convierte en error.
- Vite avisa que `vite.config.ts` usa `__dirname` en vez de `import.meta.dirname`.
- Chunks > 500 kB en `web client` (maplibre).
