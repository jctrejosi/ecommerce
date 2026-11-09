# Stack tecnológico — Ecommerce (Mercaldas)

> Inventario de herramientas y tecnologías realmente usadas en este monorepo.
> Fuentes: `package.json` de cada interfaz, `requirements.txt`, `Dockerfile`,
> `docker-compose.yml`, `Caddyfile`, `render.yaml`, `dev.js`, `prod.js`,
> `prod-local.js`, `AGENTS.md` y los `README.md` de cada servicio.
> Última revisión: 2026-09-21.

Monorepo con **múltiples interfaces web**, **3 apps móviles**, un **backend
NestJS**, un **bot de compras** y un **servicio de IA**, desplegados como un
**contenedor único** detrás de **Caddy** sobre **Render**.

---

## 1. Entorno de desarrollo

| Elemento | Detalle | Para qué |
|---|---|---|
| **Linux** | Máquina de desarrollo (`/home/jk/Proyectos/dsi/ecommerce`) | SO donde corre el desarrollo |
| **Bash** | Shell por defecto | `dev.js`/`prod.js`/`prod-local.js`, `docker-entrypoint.sh`, scripts |
| **Zed** | Editor con IA generativa integrada | Entorno de desarrollo asistido (guía `AGENTS.md`) |
| **Node.js 20+** | Backend en contenedor `node:20-bookworm-slim`; móviles Node 20+ | Backend NestJS, build de los fronts, scripts `.mjs`, orquestadores |
| **pnpm 10.34.3** | `packageManager` en los frontends y apps | Gestor de paquetes de interfaces y apps |
| **yarn** | `yarn.lock` en el backend | Gestor de paquetes del backend NestJS |
| **Python 3** | Entornos virtuales `.venv` en `bot/`, `ia-service/`, `test_db/` | Bot, servicio de IA y pruebas de ADS |
| **Docker + Docker Compose** | PostgreSQL/PostGIS, ADS, OSRM | Bases de datos y motor de rutas |
| **Android SDK** (`~/Android/Sdk`) | Con `adb`, `emulator`; AVD `delivery` (Pixel 6 · Android 36) y **KVM** | Compilar/ejecutar las apps móviles |
| **JDK 21 (Temurin)** | Portátil en `.jdk/` (apuntado desde `android/gradle.properties`) | Compilar los APK con Gradle |
| **Expo / Metro** | Dev server del JS (puertos `8081` delivery, `8082` picking) | Desarrollo de las apps React Native |
| **Windows (RDP)** | Vía `xfreerdp` + SMB | Leer el legado Advantage (driver ODBC solo existe en Windows) |
| **Git** | `.gitignore` por paquete, `AGENTS.md` | Control de versiones y convenciones del monorepo |

**Puertos de desarrollo:** backend NestJS `3000` · **CRM (proyecto hermano `dsi/crm`)**: backend `3100`, web `8444`, ia-service `8002`, Postgres operativo `5437`, Postgres analytics `5436` · bot `8001`,
OSRM `5000`, PostgreSQL `5432`, backends de apps `8081`/`8082`.

Arranque: `node dev.js` (instala dependencias faltantes, levanta PostgreSQL +
servicios + apps Expo en segundo plano y libera la terminal). Producción en
**contenedor** (el servidor): `node prod.js` (ver
[docker/](docker/README.md), [docs/DESPLIEGUE-DOCKER.md](docs/DESPLIEGUE-DOCKER.md)
y [docs/DESPLIEGUE-DESDE-CERO.md](docs/DESPLIEGUE-DESDE-CERO.md)).
Producción **bare-metal** (compila con npm/pnpm aquí): `node prod-local.js --build`.
`dev.js --help` lista todos los comandos.

---

## 2. Lenguajes

| Lenguaje | Uso |
|---|---|
| **TypeScript / JavaScript** | Backend NestJS, las 6 webs, las 3 apps móviles, scripts de BD y orquestadores |
| **Python** | Bot de compras, ia-service, pruebas de ADS/ADT |
| **SQL** | Esquema (Drizzle) y migraciones |
| **CSS (Tailwind)** | Estilos de las webs |
| **PowerShell** | Extractor del legado (`db/adt-reader/export-publidata.ps1`) |

---

## 3. Frontends web (6 + paneles)

Todas son **React + Vite + TypeScript**, con **pnpm**.

| Interfaz | Stack propio | Para qué |
|---|---|---|
| **Interface web client** (tienda) | React 18, MUI + Emotion, Radix UI (`@radix-ui/*`), react-router, axios, socket.io-client, recharts, maplibre-gl, react-hook-form, motion, sonner, embla-carousel | Tienda pública |
| **Interface web admin** | React 19, Tailwind v4, recharts, `@hello-pangea/dnd` (drag & drop), lucide-react, socket.io-client | Panel de administración (catálogo, campañas, editor de correos) |
| **Interface web analytics** (mudada al proyecto hermano `dsi/crm/interface web`) | React 19, Tailwind v4, recharts, lucide-react | Tablero de analítica y campañas del **CRM** (`dsi/crm`, backend propio en `:3100`) |
| **Interface web delivery admin** | React 19, Tailwind v4, maplibre-gl, socket.io-client | Mapa de flota y gestión de repartos |
| **Interface web picking** | React 19, Tailwind v4, html5-qrcode | Picking con escaneo de QR en navegador |
| **Interface web picking admin** | React 19, Tailwind v4, socket.io-client | Administración de picking |

Común: **Vite** (v6/v8), **TypeScript**, **Tailwind CSS v4**, **oxfmt**.

---

## 4. Apps móviles (APK) — `Interface movil *`

| App | Stack | Para qué |
|---|---|---|
| **client** | React Native + **WebView** (`react-native-webview`) que envuelve la tienda web | App Android del cliente (`com.dsi.mercaldasclient`) |
| **delivery** | **Expo SDK 57** + **Expo Router**, TanStack Query, Zustand, axios, socket.io-client, `@maplibre/maplibre-react-native`, `expo-location`, `expo-notifications`, `expo-task-manager` | App de repartidores (mapa, GPS, push, tracking) |
| **picking** | **Expo SDK 57** + **Expo Router**, TanStack Query, Zustand, `expo-camera`, socket.io-client | App de picking (escaneo, alertas) |

Común: **React Native 0.86**, **Expo**, **TypeScript**, `expo-secure-store` /
`async-storage` para persistencia. Push vía **FCM (Android)** / APNs.

**Compilación de APK:** Gradle (`./gradlew assembleRelease`), `ANDROID_HOME`,
`adb install`. La app **client** requiere JDK 21 (Temurin portátil en `.jdk/`).

---

## 5. Backend (NestJS)

| Tecnología | Para qué |
|---|---|
| **NestJS 11** | Framework del backend (`backend/`) |
| **Drizzle ORM + drizzle-kit** | ORM y migraciones (`generate`/`migrate`/`push`/`studio`) |
| **pg (node-postgres) + pool** | Conexión a PostgreSQL (pool máx. 15 por el pooler de Supabase) |
| **JWT + Passport** (`passport-jwt`, `passport-local`) | Autenticación de admin y clientes |
| **bcrypt / bcryptjs** | Hash de contraseñas |
| **class-validator / class-transformer** | Validación de DTOs |
| **Swagger / swagger-ui-express** | Documentación de la API |
| **Winston + nest-winston** | Logging estructurado |
| **Helmet, compression, cookie-parser** | Seguridad y HTTP |
| **Socket.IO** (`@nestjs/platform-socket.io`) | Tiempo real (estados de pedidos, flota, picking) |
| **@nestjs/schedule** | Tareas programadas |
| **exceljs** | Exportación/reportes en Excel |
| **Cloudinary** | Almacenamiento/CDN de imágenes |
| **@imgly/background-removal-node** | Quitar fondo a imágenes de producto |
| **Resend** | Correos transaccionales |
| **Wompi** (tarjeta, PSE, Nequi) | Pasarela de pagos |
| **Epayco** | Pasarela de pagos alterna |
| **uuid, slugify, dotenvx, ts-node** | Utilidades y entorno |

**Módulos:** `auth`, `customer-auth`, `admin-users`, `catalog`, `inventory`,
`cart`, `orders`, `payments`, `promotions`, `banners`, `popups`, `landing`,
`featured-products`, `filters`, `campaigns`, `newsletter`, `notifications`,
`delivery`, `picking`, `pickers`, `shelves`, `branches`, `geocoding`, `qr`,
`dashboard`, `settings`, `cloudinary`, `status`.

---

## 6. Inteligencia artificial

| Servicio | Stack | Para qué |
|---|---|---|
| **bot** | FastAPI + `asyncpg` + httpx + **DeepSeek (function calling)** | Chatbot de compras: busca productos, arma/consulta/modifica el carrito consultando la BD directamente. Tools: `buscar_productos`, `armar_carrito`, `agregar_al_carrito`, `ver_carrito`, `finalizar_compra`, etc. |
| **ia-service** (mudado al proyecto hermano `dsi/crm/ia-service`) | FastAPI + httpx + **DeepSeek (function calling)** | Genera contenido de campañas (WhatsApp, email con bloques del diseñador, SMS). Lo consume el backend del CRM en `POST /admin/campaigns/generate` |

---

## 7. Bases de datos

| Tecnología | Para qué |
|---|---|
| **PostgreSQL 16 + PostGIS** (`postgis/postgis:16-3.4`) | Base de datos local (Docker) y esquema de la app |
| **Supabase** | PostgreSQL gestionado de producción (se usa el **pooler**) |
| **Drizzle** (`backend/drizzle/schema.ts`) | Fuente de verdad del esquema |
| **Extensiones** | `postgis`, `citext`, `uuid-ossp`, `unaccent`, `pg_trgm` (búsqueda difusa/tolerante a tildes) |
| **Advantage Database Server (ADS)** | Base **Publidata** del legado (`db/ADDT`); `db/ads` (Docker, **pendiente del instalador**, producto descontinuado) |
| **`db/adt-reader`** | Extractor del legado: subida por SMB + `export-publidata.ps1` (PowerShell, ODBC en Windows) |
| **`test_db`** | Pruebas de conexión ADS con `pyodbc` y sondeo del protocolo ACE32 |
| **Scripts `.mjs`** | Migración local → Supabase, `pg_dump`/`pg_restore`, recuperación de imágenes y backups |

**Backups y migraciones:** `db/backups/{local,prod,supabase}`,
`migrate-local-to-supabase.mjs`, `migrate-to-prod.mjs`, `recover-*`.

---

## 8. Infra / DevOps y despliegue

| Tecnología | Para qué |
|---|---|
| **Docker multi-stage** | Imagen de producción: compila NestJS (Node 20) y empaqueta backend + bot + ia-service + Caddy; crea venvs Python para los servicios |
| **Caddy 2** | Reverse proxy único: `/bot/*` → 8001, `/ia-service/*` → 8002, resto → backend 3100; expone el `PORT` público |
| **`docker-entrypoint.sh`** | Arranca los 4 procesos y sincroniza el esquema (`sync-schema.js`) |
| **Render** | Despliegue cloud (`render.yaml`); healthcheck `/api-status` |
| **OSRM** (`osrm/osrm-backend`) | Motor de rutas por calles auto-hospedado (perfil `car`, algoritmo MLD), puerto 5000 |
| **OpenStreetMap / Geofabrik + osmium** | Datos de calles (extracto de Manizales recortado con `osmium extract`) |
| **Nominatim (OSM)** | Geocodificación de direcciones en el checkout (módulo `geocoding`, 1 req/s con caché) |
| **`dev.js` / `prod.js` / `prod-local.js`** | Orquestadores propios: dev local; producción en contenedor (`prod.js` + `docker/`, lanzador con DNS/firewall) y bare-metal (`prod-local.js`) |
| **Cloudinary** | CDN de imágenes |
| **Resend** | Envío de correos |
| **Scripts `scripts-agent/*`** | Utilidades de operación/QA: inspección de BD, seeds, pruebas E2E, generación de íconos/sonidos, validación de APIs |

**Variables de entorno clave** (`render.yaml`): `DATABASE_URL`, `JWT_SECRET`,
`CLOUDINARY_*`, `CORS_ORIGIN`, `DEEPSEEK_API_KEY`, `IA_SERVICE_DEEPSEEK_API_KEY`,
`WOMPI_*`, `EPAYCO_*`, `RESEND_API_KEY`, `QR_ANALYZER_URL`, `DB_SSL`.

---

## 9. Testing y calidad

| Tecnología | Para qué |
|---|---|
| **Jest + ts-jest** | Pruebas unitarias del backend (`*.spec.ts`) |
| **Supertest** | Pruebas e2e del backend |
| **ESLint + Prettier** | Lint y formato del backend |
| **Scripts E2E (`scripts-agent/*.cjs/.mjs/.py`)** | Pruebas funcionales: pedidos en tiempo real, flota, picking, chat de repartidor, validación de APIs |
| **`typecheck` (`tsc --noEmit`)** | Verificación de tipos en apps y algunas web |
| **Smoke tests Python** (`test_db/_smoke_*.py`) | Conectividad y búsqueda contra ADS |

---

## 10. Notas y limitaciones

- **Advantage (ADS)** es el sistema legado: el driver ODBC es **exclusivo de
  Windows** y SAP descontinuó el producto; por eso el `db/ads` en Docker quedó
  pendiente de un instalador y la extracción se hace desde una máquina Windows.
- El **cliente móvil** es un **WebView** de la tienda; solo **delivery** y
  **picking** son apps nativas React Native.
- Los **push** y la ubicación en segundo plano requieren *dev build* nativo
  (no funcionan en Expo Go).
- Producción corre como **un solo contenedor** con 4 procesos (backend, bot,
  ia-service, Caddy); no son servicios separados.
