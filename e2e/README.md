# Suite E2E · Mercaldas

Suite [Playwright](https://playwright.dev/) autocontenida para las 4 SPAs del
monorepo. **No modifica las SPAs** y **no necesita backend ni base de datos**:
todas las llamadas al API se interceptan con `page.route`.

| Proyecto Playwright | SPA | Puerto local |
| --- | --- | --- |
| `client` | `Interface web client` (tienda) | 5173 |
| `admin` | `Interface web admin` | 5273 |
| `picking` | `Interface web picking admin` | 5373 |
| `delivery` | `Interface web delivery admin` | 5473 |
| `map` | Mapa de flota real (MapLibre + WebGL) en delivery admin | 5473 |
| `smoke` | Smoke global (4 hosts o `PLAYWRIGHT_BASE_URL`) | — |

## Requisitos

- Node.js 20+ y npm.
- `node_modules` de cada SPA ya instalado (si falta, ver más abajo).
- Chromium de Playwright.

## Instalación

```bash
cd e2e
npm install
npx playwright install chromium
```

Si alguna SPA no arranca porque le falta `node_modules`:

```bash
pnpm --dir "../Interface web client" install --frozen-lockfile
pnpm --dir "../Interface web admin" install --frozen-lockfile
pnpm --dir "../Interface web picking admin" install --frozen-lockfile
pnpm --dir "../Interface web delivery admin" install --frozen-lockfile
```

> Las SPAs usan **pnpm** (`pnpm-lock.yaml`), igual que el `Dockerfile` de
> producción y el job `test-e2e` del CI. Ya no se versionan `package-lock.json`
> en esas interfaces.

> La primera ejecución de Vite puede tardar: `playwright.config.ts` da 180 s de
> margen para el arranque de cada servidor.

## Ejecutar todo

```bash
cd e2e
npx playwright test
```

Playwright levanta las 4 SPAs con `npm run dev` en los puertos indicados
(`reuseExistingServer: true`, así que si ya tienes una corriendo en ese puerto
la reutiliza). Los tests de cada SPA corren con la API mockeada; el proyecto
`smoke` comprueba además que los 4 hosts responden.

Para ver el reporte HTML:

```bash
npx playwright show-report
```

### Un solo proyecto

```bash
npx playwright test --project=client
npx playwright test --project=admin
npx playwright test --project=picking
npx playwright test --project=delivery
npx playwright test --project=map
npx playwright test --project=smoke
```

También hay atajos en `package.json`:

```bash
npm run test:client
npm run test:admin
npm run test:picking
npm run test:delivery
npm run test:map
npm run test:smoke
```

### Proyecto `map` (WebGL)

El resto de la suite corre con `--disable-webgl` porque SwiftShader es lento y
hace inestable el panel. El proyecto `map` habilita WebGL a propósito
(`MAP_CHROMIUM_LAUNCH_OPTIONS`) para ejercitar MapLibre de verdad: comprueba que
el canvas se pinta, que están los pines (repartidor, destino y sucursal al
seleccionar), que el arrastre mueve la cámara y que la rueda hace zoom. Los
tiles y el estilo se sirven offline, así que no necesita internet.

Es más lento (~35 s) y conviene ejecutarlo aparte:

```bash
npm run test:map
```

## Smoke contra producción (sin mocks)

`PLAYWRIGHT_BASE_URL` activa el modo producción:

- No se levanta ningún servidor local.
- Los tests funcionales de las SPAs se saltan automáticamente
  (`test.skip(IS_PROD_MODE)`).
- Sólo corre el proyecto `smoke` contra el host indicado y **sin interceptar
  la API**.

```bash
cd e2e
PLAYWRIGHT_BASE_URL=https://mercaldas.example.com npx playwright test --project=smoke
```

El smoke verifica que el host responde (< 500), que la app renderiza contenido y
que no hay errores de consola críticos (se filtran ruidos de red/sockets/tiles,
esperables cuando no hay backend).

Para correr el smoke contra los 4 hosts locales:

```bash
npx playwright test --project=smoke
```

## Cómo funciona el mock

Las SPAs leen `VITE_API_URL` (en sus `.env` de desarrollo apunta a
`http://localhost:3000`) y llaman **rutas raíz** (`/catalog/products`,
`/auth/login`, `/picking-admin/orders`…), no bajo `/api`. Por eso
`tests/support/mockApi.ts`:

1. Intercepta `http://localhost:3000/**` (y `127.0.0.1:3000`).
2. También registra `page.route('**/api/**', …)` por si un despliegue monta el
   backend con ese prefijo.
3. Responde CORS/preflight (los `fetch` con credenciales son cross-origin en
   desarrollo).
4. Mantiene un estado mínimo de sesión: `POST /auth/login` responde un usuario
   superusuario y `GET /auth/me` pasa de 401 a 200 después del login.
5. Corta `/socket.io` y, en delivery, bloquea `/ofm/**` para que MapLibre no
   salga a internet (el mapa puede quedar sin tiles, pero la UI no depende de
   eso).

Fixtures y helpers principales: `tests/support/mockApi.ts` y
`tests/support/urls.ts`.

## Estructura

```
e2e/
├── playwright.config.ts
├── package.json
├── tsconfig.json
└── tests/
    ├── support/
    │   ├── mockApi.ts      # mocks de API + fixtures + bloqueo de tiles
    │   └── urls.ts         # puertos, URLs locales y modo producción
    ├── client/client.spec.ts
    ├── admin/admin.spec.ts
    ├── picking/picking.spec.ts
    ├── delivery/delivery.spec.ts
    └── smoke.spec.ts
```

## Cobertura

- **Cliente:** home (banner + categorías + destacados), catálogo con productos
  mockeados, búsqueda (header y catálogo), añadir al carrito (contador/subtotal)
  y login mockeado.
- **Admin:** login, login correcto y listados de pedidos y productos.
- **Picking admin:** login y pantalla principal (estanterías), más pestaña de
  pedidos.
- **Delivery admin:** login, pantalla principal y pestañas de repartidores y
  pedidos (mapa aislado de la red).
- **Smoke:** respuesta y render de los 4 hosts (o del host de producción) sin
  errores críticos de consola.

No se cubren flujos que dependen de servicios externos reales (pagos, OAuth de
Google, sockets en vivo, cálculos de rutas OSRM ni tiles reales del mapa).
