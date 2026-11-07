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

**Totales verificados:** 530 unitarias + 10 integración backend + 257 Pytest +
28 Playwright = **825 pruebas en verde**.

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
| `payments/wompi.service.spec.ts` | 30 | aceptación, cargo con tarjeta, Bre-B, consulta de transacción (privada o pública) y errores |
| `payments/epayco.service.spec.ts` | 17 | tokenización, configuración y manejo de errores |
| `payments/payments.controller.spec.ts` | 10 | configuración pública y métodos disponibles |
| `customer-auth/customer-auth.service.spec.ts` | 76 | whitelist de `redirect_uri`, intercambio del `code`, tokens, registro, verificación y recuperación |
| `customer-auth/customer-auth.controller.spec.ts` | 24 | contratos de los endpoints de autenticación de cliente |
| `customer-auth/customers.service.spec.ts` | 13 | consulta y actualización de datos del cliente |
| `inventory/inventory.service.spec.ts` | 14 | filtros, stock bajo, reservas y agregados por sucursal |
| `delivery/delivery-orders.service.spec.ts` | 32 | máquina de estados del repartidor, ofertas, chat y notificaciones |
| `delivery/delivery-admin.service.spec.ts` | 29 | repartidores, credenciales, historial y listados con paginación |
| `delivery/delivery.service.spec.ts` | 24 | ubicación, rutas OSRM (mock) y errores 422/502/404 |
| `delivery/delivery-load.service.spec.ts` | 23 | cálculo de carga, capacidad y sobrecarga de flota |
| `delivery/driver-chat.service.spec.ts` | 17 | mensajes, límites y push tolerante a fallos |
| `delivery/delivery-auth.service.spec.ts` | 9 | login, perfil y refresh del repartidor |
| `delivery/delivery.gateway.spec.ts` | 10 | autenticación de sockets y emisiones |
| `delivery/driver-colors.spec.ts` | 4 | asignación de color de ruta |
| `campaigns/campaigns.service.spec.ts` | 72 | audiencias, deduplicación, destinatarios, relanzamiento, IA y SSE |
| `campaigns/campaigns.controller.spec.ts` | 26 | parseo de parámetros y propagación de errores en 19 endpoints |

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

Además, sobre escritura y compra:

- `tests/admin/admin-write.spec.ts` (5): alta y edición de producto, alta y
  edición de banner con subida simulada, y validación de obligatorios sin
  petición.
- `tests/client/checkout.spec.ts` (2): compra completa con pago aprobado y
  pago rechazado (`DECLINED`), emulando el evento Socket.IO de estado.

La API se intercepta con `page.route('**/api/**')` en `tests/support/mockApi.ts`,
así que las pruebas no dependen de la BD ni del backend.

## Matriz de cobertura por módulo

`●` cubierto · `◐` parcial (smoke o un flujo) · `○` pendiente

| Módulo | Endpoints | Unitarias | Integración | E2E UI | Estado |
|---|---:|---|---|---|---|
| auth | 6 | ● 16 | ● login/me/401 | ● login mock | ● |
| coupons | 7 | ● 26 | — | — | ● |
| promotions | 7 | ● 13 | — | — | ● |
| orders | 15 | ● 26 | ◐ login/API | ● checkout aprobado/rechazado | ● |
| cart | 3 | ● 3 | — | ● contador | ◐ |
| picking | 16 | ● 16 | — | ● login/cola | ◐ |
| payments | 4 | ● 57 | — | ● pago mock | ● |
| customer-auth | 24 | ● 113 | ◐ login/me | ● login mock | ● |
| inventory | 5 | ● 14 | — | — | ● |
| delivery | 32 | ● 131 | — | ● pantalla principal | ● |
| campaigns | 18 | ● 98 | — | — | ● |
| catalog | 59 | — | ◐ categorías/producto | ● catálogo/búsqueda + escritura | ◐ |
| banners | 10 | — | ◐ listado + 401 | ● alta/edición | ◐ |
| admin-users | 12 | — | ◐ 401 | ● login admin | ◐ |
| pickers | 16 | — | — | ● login picking | ◐ |
| branches | 11 | — | — | — | ○ |
| cloudinary | 1 | — | — | — | ○ |
| dashboard | 14 | — | — | — | ○ |
| featured-products | 11 | — | — | — | ○ |
| filters | 6 | — | — | — | ○ |
| geocoding | 2 | — | — | — | ○ |
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

1. **catálogo/branches**: altas, variantes e imágenes (más allá del smoke).
2. **shelves + pickers**: CRUD y asignación de estanterías.
3. **landing, popups y featured-products**: contenido editable del storefront.
4. **newsletter + notifications**: envíos y preferencias.
5. **dashboard**: agregados y métricas.
6. **settings, qr, filters, geocoding, cloudinary**: utilidades.
7. **admin-users**: roles y permisos (más allá del 401).
8. E2E: edición de banners con recorte de imagen real y multi-sucursal.

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
- **Bugs observados en `campaigns` (documentados, sin corregir):**
  1. `list` pierde los productos secundarios de campañas multi-producto
     (resuelve solo el `productId` principal).
  2. `relaunch` no valida el estado de la campaña y fuerza `audienceMode: 'auto'`,
     así que una campaña con público manual pierde ese modo al relanzarse.
  3. La nota de audiencia mixta usa `extra.clients.length` en vez del número
     realmente añadido tras el deduplicado (cosmético).
