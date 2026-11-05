# Mapa de pruebas — Ecommerce

Documento de referencia de la estrategia de pruebas y del estado real de
cobertura. El inventario de endpoints se regenera con:

```bash
node scripts-agent/list-endpoints.mjs
```

Estado actual: **349 endpoints HTTP en 28 módulos**, 4 SPAs, 1 microservicio
Python y 3 apps móviles.

## Pirámide de pruebas

| Capa | Herramienta | Alcance | Comando |
|---|---|---|---|
| Unitarias backend | **Vitest** | Lógica de negocio aislada (mocks, sin BD) | `cd backend && yarn test:unit` |
| Integración backend | **Vitest + Supertest + Testcontainers** | App NestJS completa contra PostgreSQL/PostGIS real | `cd backend && yarn test:e2e` |
| API bot | **Pytest** | FastAPI con `ASGITransport`, sin red | `cd bot && .venv/bin/python -m pytest` |
| Integración bot | **Pytest + Testcontainers** | Consultas asyncpg contra PostgreSQL 16 real | ídem (se salta sin Docker) |
| E2E web | **Playwright** | Flujos de las 4 SPAs con API mockeada | `cd e2e && npx playwright test` |
| Smoke web | **Playwright** | Hosts reales sin mocks | `PLAYWRIGHT_BASE_URL=... npx playwright test --project=smoke` |

**Totales verificados:** 100 unitarias + 10 integración backend + 257 Pytest +
21 Playwright = **388 pruebas en verde**.

## Requisitos

- **Docker** en ejecución: `testcontainers` levanta `postgis/postgis:16-3.4`
  (backend) y `postgres:16-alpine` (bot). Sin Docker, las suites de integración
  se saltan o fallan con mensaje explícito.
- **Node 20+** y `yarn` para el backend; `npm` para `e2e/`.
- **Python 3.12+** con `bot/.venv` creado desde `bot/requirements-dev.txt`.
- **Chromium** de Playwright: `cd e2e && npx playwright install chromium`.
- Disco: la imagen PostGIS ocupa ~600 MB.

## Estructura de las suites

### Backend — unitarias (`src/modules/**/*.spec.ts`)

| Archivo | Pruebas | Qué cubre |
|---|---|---|
| `auth/auth.service.spec.ts` | 16 | hash/compare, bloqueo por intentos, login, refresh y revocación |
| `coupons/coupons.service.spec.ts` | 26 | preview, validación, canje y reverso de saldo |
| `promotions/promotion-engine.service.spec.ts` | 13 | % y valor fijo, topes, categorías/productos, sucursal, exclusivas, combos |
| `cart/cart.service.spec.ts` | 3 | cotización, variantes y enganche con promociones |
| `picking/picker-queue.service.spec.ts` | 16 | ruteo (vecino más cercano/ETA) y despacho de cola |
| `orders/order-pricing.spec.ts` | 8 | subtotal, envío, descuentos, `grand_total`, saldo de cupón y `amount_to_charge` |
| `orders/webhook.controller.spec.ts` | 18 | firma Wompi válida/inválida/ausente, fail-closed y confirmación server-side |

Infraestructura: `backend/vitest.config.ts` (proyectos `unit` y `e2e`,
`unplugin-swc` para `emitDecoratorMetadata`), `backend/test/setup.ts`,
`backend/test/helpers/db-mock.ts` (drizzle encadenable).

### Backend — integración (`test/app.e2e-spec.ts`)

Levanta la app real con `Test.createTestingModule` y PostgreSQL en
Testcontainers: crea extensiones (`postgis`, `uuid-ossp`, `unaccent`, `pg_trgm`,
`citext`, `immutable_unaccent`), aplica `drizzle-kit push --force` y siembra un
admin. Cubre `GET /api-status` (BD conectada), login válido/401/400,
`/auth/me` con y sin token, catálogo público, creación de producto y `401` en
rutas admin sin token.

### Bot — Pytest (`bot/tests/`)

| Archivo | Pruebas | Qué cubre |
|---|---|---|
| `test_main.py` | 42 | `/health`, `/chat/options`, `/cart*`, `/catalog/*`, `/chat`, 422/404/502, CORS, rate limit, lifespan |
| `test_cart.py` | 15 | carrito/sesión perezosos, upsert, subtotales, `set_quantity`, `clear`, `suggest`, expiración |
| `test_tools.py` | 61 | matching, esquema `TOOLS`, filtrado por config y los 10 handlers |
| `test_database.py` | 40 | pool, búsqueda con plurales, producto/variante/stock/sugeridos |
| `test_deepseek.py` | 15 | payload, historial, tool calls, JSON inválido, loop agotado |
| `test_rate_limit.py` | 23 | ventana fija, reinicio, IPs independientes, limpieza |
| `test_recipes.py` | 26 | recetas curadas y `find_recipe` |
| `test_integration_postgres.py` | 20 | flujo carrito/catálogo/API contra PostgreSQL real |

Cobertura medida: **100 % de líneas** en `app/` (`--cov=app`).

### Web — Playwright (`e2e/`)

| Proyecto | Puerto | Pruebas |
|---|---|---|
| `client` | 5173 | home, catálogo, búsqueda, añadir al carrito, login |
| `admin` | 5273 | login, login mockeado, listado de pedidos/productos |
| `picking` | 5373 | login y pantalla principal (estanterías) |
| `delivery` | 5473 | login, pantalla principal, pestañas Repartidores y Pedidos |
| `smoke` | `PLAYWRIGHT_BASE_URL` | salud de hosts reales sin mocks |

La API se intercepta con `page.route('**/api/**')` en `tests/support/mockApi.ts`,
así que las pruebas no dependen de la BD ni del backend.

## Matriz de cobertura por módulo

`●` cubierto · `◐` parcial (smoke o un flujo) · `○` pendiente

| Módulo | Endpoints | Unitarias | Integración | E2E UI | Estado |
|---|---:|---|---|---|---|
| auth | 6 | ● 16 | ● login/me/401 | ● login mock | ● |
| coupons | 7 | ● 26 | — | — | ● |
| promotions | 7 | ● 13 | — | — | ● |
| orders | 15 | ● 26 | ◐ login/API | — | ◐ |
| cart | 3 | ● 3 | — | ● contador | ◐ |
| picking | 16 | ● 16 | — | ● login/cola | ◐ |
| catalog | 59 | — | ◐ categorías/producto | ● catálogo/búsqueda | ◐ |
| banners | 10 | — | ◐ listado + 401 | — | ◐ |
| admin-users | 12 | — | ◐ 401 | ● login admin | ◐ |
| customer-auth | 24 | — | — | ● login mock | ○ |
| payments | 4 | — | — | — | ○ |
| delivery | 32 | — | — | ● pantalla principal | ◐ |
| pickers | 16 | — | — | ● login picking | ◐ |
| branches | 11 | — | — | — | ○ |
| campaigns | 18 | — | — | — | ○ |
| cloudinary | 1 | — | — | — | ○ |
| dashboard | 14 | — | — | — | ○ |
| featured-products | 11 | — | — | — | ○ |
| filters | 6 | — | — | — | ○ |
| geocoding | 2 | — | — | — | ○ |
| inventory | 5 | — | — | — | ○ |
| landing | 21 | — | — | — | ○ |
| newsletter | 14 | — | — | — | ○ |
| notifications | 2 | — | — | — | ○ |
| popups | 7 | — | — | — | ○ |
| qr | 6 | — | — | — | ○ |
| settings | 5 | — | — | — | ○ |
| shelves | 15 | — | — | — | ○ |

Cobertura global de líneas del backend: **~56 %** (incluye
`drizzle/schema.ts`, que es declarativo y no ejecuta lógica).

## Backlog priorizado

1. **payments**: `wompi.service` (creación de transacciones, Bre-B, errores de
   red) y `payment-verification` (polling hasta 10 intentos).
2. **customer-auth**: OAuth de Google, magic links, verificación de correo.
3. **inventory + picking**: concurrencia, reservas y descuento de stock.
4. **delivery**: cálculo de rutas con OSRM (mockear HTTP) y zonas de entrega.
5. **campaigns + newsletter**: generación de audiencias y envíos.
6. **E2E de escritura** en admin: alta/edición de productos y banners.
7. **Checkout completo** con pago aprobado (mock de Wompi en Playwright).

## Convenciones

- Backend: el archivo de prueba vive junto al servicio (`*.spec.ts`). Mockea
  dependencias externas; nunca uses la BD real en unitarias.
- Integración: nuevas suites van en `backend/test/` y reutilizan la fixture de
  Testcontainers. Siembra solo lo indispensable.
- Bot: todo lo que haga red se mockea; los tests que necesiten Docker llevan el
  marcador `integration`.
- E2E: selectores tomados del código real de la SPA; nada de `nth-child`
  frágiles. Cada SPA tiene su proyecto y su puerto.

## Hallazgos de esta implementación

- **Bug real corregido** en `bot/app/database.py`: `_PRODUCT_SQL` no
  seleccionaba `image` y `_product()` hacía `row["image"]`, por lo que
  `ver_producto` lanzaba `KeyError`. Se añadió `MIN(m.path) AS image` con sus
  `LEFT JOIN`.
- **Refactor sin cambio de comportamiento** en `orders.service.ts`: el cálculo
  de importes se extrajo a `orders/order-pricing.ts` para poder probarlo puro.
- `getTransaction` de Wompi acepta la llave pública como respaldo (no hay
  `WOMPI_PRIVATE_KEY` en producción).
