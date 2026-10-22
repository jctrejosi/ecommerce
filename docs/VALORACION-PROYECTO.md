# Valoración económica — Mercaldas Ecommerce

> **Documento:** valoración para venta, licenciamiento o inversión.
> **Versión:** 1.0 · 22 de octubre de 2026.
> **Base analizada:** rama `dev`, 429 commits entre el **14 de julio de 2026** y el **22 de octubre de 2026** (100 días).
> **Moneda:** USD. Conversión de referencia: **COP 4.000 / USD** (supuesto explícito; ajustar a la TRM del cierre).
> **Alcance:** este repositorio. **No incluye** el CRM hermano (`/home/jk/Proyectos/dsi/crm`), la infraestructura física, la marca, el dominio ni las cuentas de terceros, salvo que se indique.
> **Naturaleza:** documento de negociación y sustento técnico. No es una tasación certificada, una opinión de auditoría financiera ni una oferta vinculante.

---

## 0. Cómo leer este informe

Este documento responde tres preguntas distintas, que suelen confundirse:

1. **¿Cuánto costaría reconstruirlo?** → coste de reposición (sección 4).
2. **¿Cuánto vale el activo tal como está?** → valor de referencia ajustado por riesgo (sección 5).
3. **¿En cuánto se puede negociar?** → escenarios y precios (sección 6).

Las tres cifras son diferentes y todas son defendibles. El error más caro al vender sería pedir “lo que costó producirlo” (unas pocas semanas de trabajo con IA) o “lo que costaría reconstruirlo” sin descontar el riesgo. El precio razonable vive entre esos dos extremos.

**Convenciones:**

- Cifras en USD con separador de miles (`.`), salvo que se indique otra moneda.
- “PM” = persona-mes de 160 horas.
- “Terminado” tiene una definición verificable en la sección 3.4. No significa “compila”, significa “opera y se puede recibir sin sorpresas”.
- Los rangos de tarifas son referencias de mercado consultadas en octubre de 2026; no son cotizaciones vinculantes. Cada fila indica su nivel de confianza.

---

## 1. Resumen ejecutivo

### 1.1 Qué es

Mercaldas Ecommerce es una plataforma de comercio electrónico a medida para una cadena de retail, compuesta por:

- **Backend NestJS** con 40 controladores, **335 endpoints** y **89 tablas** Drizzle/PostgreSQL.
- **4 interfaces web** (tienda, administración, delivery admin, picking admin), **3 apps móviles** (cliente en WebView, delivery y picking en Expo/React Native) y **3 wrappers Electron** para escritorio. La interfaz de analítica y el `ia-service` viven en el repo hermano del CRM y no se cuentan aquí.
- **Bot de compras** en FastAPI con *function calling* sobre DeepSeek (32 rutas).
- **Integración con el ERP legado Advantage/Fortuner/TIDSAL** vía ODBC en Windows, con mapeo de esquema y documentación de datos.
- **Pagos** con Wompi (tarjeta; Nequi/PSE en backlog), Bre-B (transferencia manual verificada por el admin) y Epayco, **tiempo real** con Socket.IO, **mapas/rutas** con OSRM y MapLibre, **notificaciones push**, **QR/códigos de barras**, **fidelización**, **campañas**, **newsletter** y **auditoría**.
- **Despliegue en producción** en un contenedor único (backend + bot + Caddy) detrás de un edge Caddy con TLS, CSP, rate limiting y CI/CD desde `master`.

No es un “ecommerce de plantilla”. Es un sistema operativo de retail con múltiples superficies y una integración profunda con un ERP descontinuado, que es a la vez su mayor foso y su mayor riesgo.

### 1.2 Estado real

| Dimensión | Estado | Evidencia |
|---|---|---|
| Producto en producción | **Sí**, `mercaldas.jcti.xyz` | Despliegue Docker/Caddy documentado en `docs/DESPLIEGUE-DOCKER.md` y `docs/VPS-WINDOWS.md` |
| Flujo principal de compra | **Operativo en producción según lo reportado**; el backlog local marca GEN-01 (llave Wompi) y Nequi/PSE en stub | `docs/informe-pendientes.md` PAG-01, PAG-02, GEN-01 |
| Inventario | **No reserva/descuenta** stock al crear el pedido | `docs/informe-pendientes.md` PAG-03, verificado en `orders.service.ts` |
| Rastreo al cliente | **Mock** (“Diego Martínez” fijo) y botones sin handler | `docs/informe-pendientes.md` CTA-01 |
| Especificaciones de producto | **Plantillas inventadas** por categoría | `docs/informe-pendientes.md` PRD-01 |
| Pruebas automatizadas | **0 archivos `*.spec`/`*.test`**; el CI solo construye la imagen | Inventario del repo; `.github/workflows/ci-cd.yml` |
| Documentación | **Muy por encima del promedio**: ~7.828 líneas en `docs/` | `DATABASE.md`, `SECURITY.md`, ERP, despliegue, CI/CD, runbooks |
| Seguridad | **Buena base**: TLS, HSTS, CSP, CORS allowlist, rate limit, usuario no-root, BD interna | `docs/SECURITY.md` |
| Mantenibilidad | **Riesgo alto**: sin tests, un autor principal (bus factor 1), deuda funcional declarada | Este informe, secciones 3 y 9 |

### 1.3 Cifras clave

| Métrica | Valor |
|---|---|
| LOC de producto (sin utilería ni datos) | ~136.600 |
| LOC totales del repo | ~193.700 en 2.408 archivos |
| Backend | 43.266 LOC · 261 archivos |
| Interfaces web | 61.307 LOC (client 21.548 + admin 25.059 + delivery 7.422 + picking 7.278) |
| Apps móviles | 20.808 LOC (client 7.730 + delivery 6.762 + picking 6.316) |
| Escritorio Electron | 4.662 LOC (3 × 1.554, prácticamente idénticos) |
| Bot | 2.223 LOC |
| Documentación | 7.828 líneas |
| Commits | 429 en 100 días |
| Esfuerzo humano equivalente estimado | **51–77 PM** (8.160–12.320 h) |
| Coste de reposición estimado | **USD 285.000–680.000** (central ~460.000) |
| Valor de referencia ajustado por riesgo | **~USD 270.000** |
| Precio recomendado “terminado y funcionando” | **USD 105.000** (rango 90.000–130.000) |

### 1.4 Conclusión de valor

| Escenario | Qué recibe el comprador | Precio objetivo | Rango | COP (millones) | Riesgo para el comprador |
|---|---|---|---|---|---|
| **A. As-is** | Código, documentación y 30 días de transición; deuda declarada | **USD 65.000** | 55.000–85.000 | 220–340 | Alto |
| **B. Terminado** | A + cierre de los 6 críticos + pruebas de humo/E2E + 60 días de garantía | **USD 105.000** | 90.000–130.000 | 360–520 | Medio |
| **C. Llave en mano** | B + despliegue en infraestructura del cliente + capacitación + 6 meses de soporte + cesión de IP | **USD 150.000** | 130.000–180.000 | 520–720 | Bajo |
| **D. SaaS / licencia** | Implementación + suscripción; el vendedor retiene el código | **USD 30.000 + 3.000/mes** | 25.000–45.000 + 2.000–5.000/mes | 100–180 + 8–20/mes | Compartido |
| **E. Activo operativo** | Empresa, marca, clientes, contratos y datos | 1–2× ingresos anuales o 2–4× EBITDA | según *due diligence* | — | Bajo (para el comprador) |

**Mínimo aceptable:** USD 40.000 (solo as-is, sin garantía, sin exclusividad y con el comprador pagando la transferencia).
**Aspiracional:** USD 180.000–220.000 si el comprador es estratégico (ya opera con Advantage/Fortuner) o si se vende como white-label con contratos recurrentes.

### 1.5 Recomendación

1. **No vender “código pelado” a un comprador que solo compara con Shopify.** Ese comprador no valora la integración con el ERP ni las apps de reparto/picking; va a descontar todo lo que no entienda.
2. **El mejor comprador es una empresa que ya usa Advantage/Fortuner** (o su integrador). Para ella, el mapeo de TIDSAL/DOMDIA/DOMITE y la operación ya resuelta valen más que el código.
3. **Cerrar los 6 críticos antes de vender “terminado”** cuesta ~USD 20.000–35.000 y permite subir el precio en ~USD 40.000–50.000. Es la inversión con mejor retorno.
4. **La vía más rentable a largo plazo es el white-label/licencia**, no la venta única: el mismo núcleo se revende a otros retailers del ecosistema Advantage con implementación de USD 25.000–50.000 y suscripción de USD 1.000–3.000/mes.
5. **Documentar y transferir es parte del precio.** Un comprador paga más por un activo que puede recibir sin depender del vendedor. El bus factor 1 es hoy el mayor descuento invisible.

---

## 2. Alcance construido

### 2.1 Inventario técnico

| Workspace | LOC código | Archivos | Rol | ¿Producto? |
|---|---:|---:|---|---|
| `backend` | 43.266 | 261 | API NestJS, 335 endpoints, 89 tablas | Sí |
| `Interface web admin` | 25.059 | 51 | Panel de administración | Sí |
| `Interface web client` | 21.548 | 76 | Tienda pública | Sí |
| `Interface movil client` | 7.730 | 182 | App cliente (WebView) | Sí, valor limitado |
| `Interface web delivery admin` | 7.422 | 38 | Gestión de flota y repartos | Sí |
| `Interface web picking admin` | 7.278 | 26 | Administración de picking | Sí |
| `Interface movil delivery` | 6.762 | 223 | App de repartidores (Expo) | Sí |
| `Interface movil picking` | 6.316 | 148 | App de picking (Expo) | Sí |
| `entregables raíz` | 3.641 | 8 | `prod.js`, `dev.js`, `entrypoint`, orquestadores | Sí (DevOps) |
| `bot` | 2.223 | 12 | Chatbot FastAPI + DeepSeek | Sí |
| `Interface desktop admin/delivery/picking` | 4.662 | 39 | 3 wrappers Electron (casi idénticos) | Sí, valor bajo |
| `docker` + `deploy` | 596 | 8 | Imagen, compose, Caddy, despliegue | Sí (DevOps) |
| `delivery-routing` + `backend-tracking` | 91 | 6 | Utilidades de rutas/tracking | Sí (soporte) |
| **Subtotal producto** | **~136.594** | — | — | — |
| `scripts-agent` | 39.106 | 369 | Utilidades de operación/QA, seeds, extracción ERP | No producto; sí valor de traspaso |
| `db` | 17.143 | 928 | Migraciones, seeds, datos, backups, diccionarios | Mixto; no todo es software |
| `test_db` | 873 | 10 | Pruebas de conexión ADS | Soporte del ERP |
| `docs` | 7.828 líneas | 20 | Documentación | Activo intangible |
| **Total repo** | **193.716** | **2.408** | — | — |

> Los LOC son una medida de complejidad, no de precio. `scripts-agent` y `db` se excluyen del cálculo de reposición para no inflar el valor con utilería y datos.

### 2.2 Módulos funcionales

**Backend (28 módulos):** `auth`, `customer-auth`, `admin-users`, `catalog`, `inventory`, `cart`, `orders`, `payments`, `promotions`, `banners`, `popups`, `landing`, `featured-products`, `filters`, `campaigns`, `newsletter`, `notifications`, `delivery`, `picking`, `pickers`, `shelves`, `branches`, `geocoding`, `qr`, `dashboard`, `settings`, `cloudinary`, `status`.

**Superficies:**

| Superficie | Contenido | Valor para el comprador |
|---|---|---|
| Tienda web | Landing, catálogo, producto, carrito, checkout, cuenta, rastreo, chatbot | Alto: es la cara del negocio |
| Admin web | Catálogo, pedidos, banners, campañas, reportes, configuración | Alto: operación diaria |
| Delivery admin | Mapa de flota, asignaciones, rutas, estados | Medio-alto: diferenciador operativo |
| Picking admin | Órdenes de picking, escaneo, alertas | Medio-alto: eficiencia de bodega |
| App cliente | WebView de la tienda + notificaciones | Medio: bajo coste de reposición |
| App delivery | GPS, mapa, push, tareas en segundo plano | Alto: operación en calle |
| App picking | Escaneo QR/código, alertas en tiempo real | Alto: operación de bodega |
| Desktop | Envoltorios Electron de los paneles | Bajo: reutiliza las webs |
| Bot | Búsqueda, armado de carrito, consulta de pedidos | Medio: diferenciador de experiencia |

**Integraciones verificadas por análisis de código:** Wompi (23 archivos), Google OAuth (web y móvil), Cloudinary, DeepSeek, OSRM, Socket.IO (101 archivos), ERP Advantage/Fortuner/TIDSAL (92 archivos), notificaciones push, QR, códigos de barras, geocodificación/Nominatim, rate limiting, auditoría, newsletter, campañas, fidelización, sucursales, inventario, picking y entregas.

### 2.3 Lo que no es producto (y no debe inflar el precio)

- **`scripts-agent` (39.106 LOC):** utilidades de operación, QA, seeds, generación de íconos, extracción del ERP y pruebas manuales. Tiene valor real para el traspaso, pero no es una funcionalidad que el cliente final compre.
- **`db` (17.143 LOC, 928 archivos):** migraciones, seeds, scripts de backup, diccionarios y **volcados de datos**. Los backups no son software; los datos personales no se venden sin cumplir la ley.
- **`docs` (7.828 líneas):** no es código, pero reduce el coste de *due diligence* y acelera la transición. Es un activo intangible que justifica parte de la prima.
- **`test_db` (873 LOC):** soporte de la integración ADS, no producto.
- **Los 3 Electron:** son el mismo wrapper con distinto *branding*; su coste de reposición es bajo y no deben valorarse como tres productos independientes.

### 2.4 Activos intangibles (los que sostienen el precio)

| Activo | Por qué importa | ¿Replicable? |
|---|---|---|
| **Mapeo del ERP Advantage/Fortuner/TIDSAL** | El driver ODBC es solo Windows, SAP descontinuó el producto y el esquema legado no está documentado públicamente. Hay 92 archivos y documentación específica. | Difícil; requiere acceso al ERP y conocimiento del negocio |
| **Operación real en producción** | TLS, DNS, Caddy, CI/CD, contenedor, runbooks, dominio y certificados ya funcionando. | Costoso en tiempo; no imposible |
| **10 superficies y sistema de diseño** | Tienda, admin, delivery, picking, apps y desktop con una identidad visual coherente. | Costoso; no es un template |
| **Documentación técnica** | `DATABASE.md` (2.588 líneas), `SECURITY.md`, runbooks, plan de integración ERP, CI/CD. | Costoso; rara en proyectos freelance |
| **Conocimiento del negocio** | Reglas de precios, sucursales, inventario, picking, rutas, fidelización, campañas. | No está en el código; está en las personas |
| **Datos y esquema** | 89 tablas y datos reales de catálogo/operación (sujetos a protección de datos). | No si no se transfieren con consentimiento |

### 2.5 Lo que no se incluye (delimítelo por escrito)

- El **CRM** (`/home/jk/Proyectos/dsi/crm`), su interfaz de analítica y su `ia-service`.
- La **marca “Mercaldas”**, el dominio `mercaldas.jcti.xyz`, los logos y las imágenes de producto, salvo que se incluyan expresamente.
- Las **cuentas de terceros**: Wompi, Epayco, Google OAuth, Cloudinary, Resend, DeepSeek, FCM/APNs, OSRM/Nominatim.
- La **infraestructura** (VPS Windows, licencias de Windows, Docker, WSL) y el **ERP** (licencia ADS, acceso ODBC, soporte de SAP).
- La **base de datos de producción** con datos personales, salvo transferencia con base legal y acuerdo de tratamiento.
- El **equipo humano** y el compromiso de soporte, salvo el escenario C.

---

## 3. Estado real y deuda

### 3.1 Lo que funciona

- Compra completa con tarjeta/Bre-B, creación de pedido, historial y estados. Bre-B se confirma manualmente por el admin (PAG-06).
- Catálogo con productos, variantes, atributos, precios, imágenes y filtros.
- Administración de pedidos, catálogo, banners, campañas, newsletter y configuración.
- Delivery con asignación, mapa, rutas y estados en tiempo real.
- Picking con órdenes, escaneo y alertas.
- Bot de compras con búsqueda, carrito y consulta de pedidos.
- Autenticación de admin y clientes con JWT/refresh, roles y sesiones.
- Sincronización/documentación del ERP y extracción desde Windows.
- Despliegue reproducible con Docker, Caddy, TLS y CI/CD.

### 3.2 Backlog crítico declarado

El propio equipo documenta la deuda en `docs/informe-pendientes.md`. Los hallazgos de severidad **Alta** son:

| ID | Hallazgo | Impacto comercial | Esfuerzo de cierre |
|---|---|---|---|
| PAG-01 | Nequi no procesa el pago (stub) | Pérdida de ventas y confianza; el cliente cree que pagó | 32 h |
| PAG-02 | PSE no crea transacción (stub) | Pérdida de ventas bancarizadas | 32 h |
| PAG-03 | El pedido no reserva/descuenta inventario | Sobreventa, inventario inconsistente, reclamos | 48 h |
| PRD-01 | Especificaciones/descripción de producto inventadas | Información falsa al comprador; riesgo legal/consumidor | 24 h |
| CTA-01 | Rastreo mock y botones sin handler | Mala experiencia; el cliente no puede contactar al repartidor | 48 h |
| GEN-01 | `WOMPI_PRIVATE_KEY` vacía | El cobro con tarjeta falla al confirmar | 4 h |

> **Alcance de la auditoría:** el backlog cubre solo la **tienda web**. Admin, delivery, picking y apps móviles no fueron auditados a fondo. El coste real de cierre podría ser mayor; trátelo como un mínimo, no como un techo.

**Coste estimado de cierre (los 6 críticos + pruebas + seguridad):**

| Ítem | Horas |
|---|---:|
| PAG-01 + PAG-02 (Nequi/PSE) | 64 |
| PAG-03 (inventario) | 48 |
| PRD-01 (especificaciones reales) | 24 |
| CTA-01 (rastreo real) | 48 |
| GEN-01 (configuración Wompi) | 4 |
| **Subtotal críticos** | **188** |
| Pruebas de humo/E2E de flujos críticos | 120 |
| Revisión de seguridad/dependencias | 40 |
| Gestión, aceptación y regresión | 32 |
| Contingencia (10%) | 38 |
| **Total** | **418 h (~2,6 PM)** |

A USD 40–70/h: **USD 16.720–29.260**; con margen de riesgo y coordinación: **USD 20.000–35.000**.

### 3.3 Calidad y mantenibilidad

**Fortalezas:**

- Documentación excepcional para un proyecto de este tamaño.
- Separación de módulos y DTOs validados; guards por rol; refresh tokens con rotación.
- Despliegue con un solo punto de entrada, TLS, HSTS, CSP, CORS allowlist, rate limit y usuario no-root.
- CI/CD que construye exactamente la imagen que se despliega.
- Scripts de operación y QA que facilitan la transición.

**Debilidades:**

- **0 pruebas automatizadas** en el repo; el CI no ejecuta tests. La validación es manual mediante `scripts-agent`.
- **Bus factor 1:** el conocimiento de despliegue, ERP y reglas de negocio está concentrado.
- **Deuda funcional** en pagos, inventario, rastreo y datos de producto.
- **Código generado con asistencia de IA y auditado por un programador:** rápido de producir, pero un comprador exigirá auditoría, pruebas y garantías.
- **Un solo contenedor y una sola instancia:** el rate limit es en memoria y no hay escala horizontal.
- **Infraestructura Windows + WSL + Docker + portproxy:** funcional, pero más frágil que un Linux nativo.
- **Backups y monitoreo:** hay scripts y healthchecks, pero no se evidenció una programación automática de backups ni alerting dedicado.

### 3.4 Definición de “terminado y funcionando”

Para poder cobrar el escenario B o C, el comprador debe poder verificar:

- [ ] Los 6 críticos cerrados o excluidos por escrito con descuento.
- [ ] Pago con tarjeta, Nequi y PSE probado en producción (o sandbox equivalente) con confirmación y webhook.
- [ ] Inventario reservado/descontado dentro de la transacción de creación del pedido.
- [ ] Rastreo con datos reales de `delivery_assignments`/`delivery_driver_locations`.
- [ ] Especificaciones y descripción del producto leídas de la BD, sin plantillas inventadas.
- [ ] Pruebas de humo/E2E de login, catálogo, carrito, checkout, pedido, delivery, picking y admin.
- [ ] CI que ejecute esas pruebas y falle el despliegue si no pasan.
- [ ] Despliegue reproducible en un VPS limpio siguiendo el runbook.
- [ ] Secretos rotados y fuera del repositorio; cuentas de terceros transferidas o recreadas.
- [ ] Backups y restauración probados al menos una vez.
- [ ] Documento de limitaciones conocido y firmado.
- [ ] Cesión de IP y auditoría de licencias de terceros.

Si no se cumplen, no se debe vender como “terminado”; se vende como as-is con descuento.

---

## 4. Metodología de valoración

### 4.1 Por qué no usar los LOC como precio

Un cálculo ingenuo sería: 136.600 LOC ÷ 12 LOC/hora ≈ 11.400 horas ≈ USD 500.000. Ese número coincide con el coste de reposición, pero por la razón equivocada: los LOC incluyen código repetitivo, generado, estilos y *scaffolding*. Además, con IA se producen muchas más líneas por hora, pero también se acumula deuda de revisión.

La valoración correcta combina:

1. **Esfuerzo humano equivalente** por módulo (lo que tardaría un equipo profesional en reconstruirlo con calidad).
2. **Tarifas de mercado** para ese esfuerzo.
3. **Ajustes por riesgo** (IA, tests, deuda, bus factor).
4. **Factor de comercialización** (qué fracción de ese valor está dispuesto a pagar un comprador por el activo, dado que tiene alternativas).

### 4.2 Esfuerzo humano equivalente

Se estima lo que costaría **reconstruir el producto desde cero** con un equipo profesional, incluyendo descubrimiento, diseño, implementación, QA, despliegue y documentación. No es el tiempo que tomó con IA.

| Módulo | PM bajo | PM alto |
|---|---:|---:|
| Descubrimiento, UX/UI y sistema de diseño (10 superficies) | 3 | 5 |
| Backend núcleo: auth, usuarios, catálogo, carrito, pedidos, pagos, inventario, sucursales | 10 | 14 |
| Backend operativo: delivery, picking, shelves, rutas/OSRM, notificaciones, sockets, auditoría, reportes | 5 | 7 |
| Backend comercial: promociones, cupones, fidelización, campañas, newsletter, banners, popups | 3 | 5 |
| Tienda web (38 vistas, checkout, cuenta, catálogo, landing) | 4 | 6 |
| Admin web (27 vistas, catálogo, pedidos, banners, campañas, reportes) | 5 | 7 |
| Paneles delivery/picking (14 + 11 vistas) | 3 | 4 |
| Apps móviles (cliente WebView + delivery + picking; 27 pantallas) | 5 | 8 |
| Wrappers Electron (3) | 1 | 2 |
| Bot FastAPI + herramientas DeepSeek | 1,5 | 3 |
| Integración ERP Advantage (mapeo, extracción, sync, documentación) | 4 | 6 |
| DevOps/seguridad: Docker, Caddy, TLS, CSP, rate limit, CI/CD, VPS Windows, runbooks | 2,5 | 4 |
| QA, hardening, aceptación y gestión de proyecto | 4 | 6 |
| **Total** | **51** | **77** |

**Horas:** 51 × 160 = **8.160 h**; 77 × 160 = **12.320 h**. Punto medio: 64 PM ≈ **10.240 h**.

**Contraste:** un equipo de 5–6 personas durante 10–12 meses produce 50–72 PM. La estimación es coherente con el alcance (335 endpoints, 89 tablas, 10 superficies, ERP, bot).

### 4.3 Tarifas de mercado consultadas

| Referencia | Rango | Fuente (consultada 2026-10-22) | Confianza | Uso |
|---|---|---|---|---|
| Freelance senior full-stack LatAm | USD 45–88/h; tech lead 85–110/h | `index.dev`, `curotec.com` | Media | Contraste superior |
| Agencia nearshore LatAm | USD 35–70/h; Colombia 45–65/h; senior 60–75/h | `devnearshore.com` | Media | **Base del cálculo** |
| Agencia EE.UU./Europa occidental | USD 110–160/h; senior/lead 150–200/h | Referencia secundaria | Baja | Contexto, no base |
| Ecommerce a medida con backoffice | USD 50.000–250.000 | Estimación de mercado no verificada | Baja | Este proyecto excede el rango estándar |
| Ecommerce custom (referencia Shopify) | USD 2.000–20.000+ | `shopify.com/blog/ecommerce-website-cost` | Media | No comparable por alcance |
| App móvil por plataforma | Simple 3.000–8.000; compleja 50.000–150.000; iOS 38.000–171.000 | `buildfire.com` | Baja | 3 apps |
| Integración con ERP | USD 5.000–100.000 | Estimación de mercado no verificada | Baja | Coherente con 20.000–50.000 |
| Salario senior full-stack Colombia | COP 12–25 millones/mes | Estimación de mercado no verificada | Baja | Coste real de producción |
| Shopify Plus | USD 2.300–2.500/mes (1–3 años); 0,20% por transacción con gateway externo | `shopify.com/plus/pricing` | Alta | Benchmark SaaS |

**Fuentes inaccesibles (no usadas como dato):** `arc.dev`, `accelerance.com`, `simform.com`, `webfx.com`, `getonbrd.com`, `integrate.io` (404); `netsuite.com` (403); `paylab.com` (sin datos para Colombia); `talent.com` (sin cifras); Upwork y DesignRush (403/Cloudflare).

> Las tarifas son rangos, no cotizaciones. Si el comprador pide una referencia formal, solicite tres cotizaciones de fábricas de software por el mismo alcance; el promedio será su mejor ancla.

### 4.4 Coste de reposición

Con la base nearshore LatAm (USD 35–55/h) y 8.160–12.320 h:

| Escenario | Cálculo | USD |
|---|---|---:|
| Bajo | 8.160 h × USD 35/h | **285.600** |
| Central | 10.240 h × USD 45/h | **460.800** |
| Alto | 12.320 h × USD 55/h | **677.600** |

**Rango de reposición: USD 285.000–680.000; central ~USD 460.000.**

Si se contratara una agencia de EE.UU./Europa a USD 100–160/h, el mismo alcance costaría **USD 816.000–1.970.000**. No use ese número como precio de venta en Colombia; úselo solo para explicar el valor a un comprador internacional.

**Contraste ascendente (bottom-up):**

| Componente | USD bajo | USD alto |
|---|---:|---:|
| Base: backend + tienda + admin + pagos (sin ERP avanzado) | 150.000 | 250.000 |
| 3 apps móviles | 60.000 | 130.000 |
| Paneles delivery/picking | 30.000 | 60.000 |
| Wrappers Electron | 6.000 | 15.000 |
| Bot | 10.000 | 25.000 |
| Integración ERP Advantage | 20.000 | 50.000 |
| DevOps/seguridad/CI-CD | 15.000 | 30.000 |
| UX/UI/sistema de diseño | 20.000 | 40.000 |
| **Total** | **311.000** | **600.000** |

El contraste ascendente (USD 311.000–600.000, central ~455.000) converge con el cálculo por esfuerzo. Esa convergencia es la mejor defensa del número.

### 4.5 Contraste con el esfuerzo real (la IA cambia la economía, no el valor)

| Dato | Valor |
|---|---|
| Periodo | 14 jul 2026 → 22 oct 2026 (100 días) |
| Commits | 429 |
| Equipo | Esencialmente un desarrollador + asistencia de IA + auditoría |
| Coste real estimado de producción | USD 15.000–30.000 (salario/oportunidad + herramientas + infraestructura) |
| Esfuerzo humano equivalente | 51–77 PM (8.160–12.320 h) |
| Apalancamiento aparente | 10–25× en velocidad de producción, según la dedicación real |

**Interpretación correcta:** la IA redujo el **coste de producción**, no el **coste de reposición** del comprador. El comprador no hereda la IA ni el contexto; hereda un sistema que tendría que reconstruir o mantener. Por eso el precio se ancla en el coste de reposición ajustado, no en el coste del vendedor.

**Interpretación comercial:** como el coste del vendedor es bajo, hay margen para negociar. El precio mínimo rentable puede ser USD 40.000–55.000; el precio de mercado puede ser USD 90.000–130.000. Esa brecha es la negociación.

### 4.6 De coste a precio: factores de comercialización

El valor de reposición no es el precio de venta. Un comprador paga una fracción porque:

- Asume el riesgo de mantenimiento y deuda.
- Tiene alternativas (construir, contratar, SaaS, no comprar).
- No hereda al equipo ni el contexto.
- Necesita invertir en transición, auditoría y operación.

Los factores usados en este informe son:

| Perfil de comprador | Factor sobre el valor ajustado | Razón |
|---|---:|---|
| Comprador con equipo propio, as-is | 20–30% | Asume toda la deuda y el riesgo |
| Empresa que quiere operar ya (terminado) | 33–45% | Riesgo reducido, pero necesita transición |
| Empresa sin equipo técnico (llave en mano) | 48–65% | Incluye despliegue, capacitación, soporte e IP |
| Comprador estratégico (ERP/white-label) | 65–80% | Valora el foso y la reutilización |

Estos factores no son constantes científicas; son parámetros de negociación. Ajuste según el poder de negociación y las alternativas del comprador.

---

## 5. Valoración

### 5.1 Cascada de valor

| Paso | Cálculo | USD |
|---|---|---:|
| Coste de reposición central | 64 PM × 160 h × USD 45/h | 460.800 |
| − Riesgo IA / sin tests / bus factor (30%) | −138.240 | 322.560 |
| − Deuda funcional alta (15%) | −48.384 | 274.176 |
| **= Valor de referencia ajustado** | | **≈274.000** |
| × Factor as-is (24%) | 274.176 × 0,24 | **≈65.000** |
| × Factor terminado (38%) | 274.176 × 0,38 | **≈105.000** |
| × Factor llave en mano (55%) | 274.176 × 0,55 | **≈150.000** |

**Por qué estos descuentos:**

- **30% por IA/sin tests/bus factor:** un comprador técnico descuenta por riesgo de mantenimiento, ausencia de pruebas, estilo inconsistente y dependencia del autor. Si se añaden tests, auditoría y transición, el descuento baja a 15–20%.
- **15% por deuda funcional:** los 6 críticos están documentados y su cierre cuesta USD 20.000–35.000; el descuento refleja el coste más el riesgo percibido.
- **Factores de comercialización:** reflejan el riesgo que asume cada perfil y el alcance de lo que recibe.

### 5.2 Escenarios de venta

#### A. As-is — USD 55.000–85.000 (objetivo 65.000)

**Incluye:** código fuente, documentación, 30 días de transición, lista de limitaciones, instrucciones de despliegue.

**No incluye:** cierre de críticos, garantía, soporte, despliegue, marca, datos, cuentas de terceros, exclusividad.

**Comprador ideal:** empresa con equipo técnico que quiere acelerar 6–10 meses y asumir la deuda.

**Riesgo:** el comprador descubre los stubs y pide descuentos; mitíguelo con transparencia y un precio ya descontado.

#### B. Terminado — USD 90.000–130.000 (objetivo 105.000)

**Incluye:** A + cierre de los 6 críticos + pruebas de humo/E2E + 60 días de garantía de defectos + documentación actualizada + despliegue de referencia.

**No incluye:** soporte extendido, nuevas funcionalidades, marca/datos, exclusividad.

**Comprador ideal:** retailer que quiere operar en 30–60 días y no tiene equipo para cerrar la deuda.

**Riesgo:** el alcance de “terminado” se desborda; fíjelo con la checklist de la sección 3.4 y un cambio de alcance por escrito.

#### C. Llave en mano — USD 130.000–180.000 (objetivo 150.000)

**Incluye:** B + despliegue en la infraestructura del cliente + capacitación (2–3 sesiones) + 6 meses de soporte con SLA + cesión de IP + transferencia de cuentas + runbook operativo.

**No incluye:** nuevas funcionalidades, migración de datos históricos, licencias de terceros, ERP.

**Comprador ideal:** empresa sin equipo técnico o que quiere externalizar la operación.

**Riesgo:** el soporte puede consumir el margen; limite horas y defina SLA.

#### D. SaaS / licencia — USD 25.000–45.000 + USD 2.000–5.000/mes

**Incluye:** implementación, configuración, hosting, mantenimiento, actualizaciones y soporte. El vendedor retiene el código.

**No incluye:** personalizaciones mayores, integraciones nuevas, datos del cliente.

**Comprador ideal:** retailer que no quiere comprar un activo ni contratar un equipo.

**Benchmark:** Shopify Plus cuesta USD 2.300–2.500/mes solo de plataforma, sin ERP Advantage, sin apps de reparto/picking y sin las reglas de negocio de Mercaldas. Una suscripción de USD 2.000–5.000/mes es defendible si el cliente factura >USD 300.000/mes y el sistema le ahorra operación.

**Ventaja:** ingresos recurrentes; a 3 años, USD 72.000–180.000 de suscripción + USD 25.000–45.000 de implementación = USD 97.000–225.000. **Desventaja:** soporte, hosting y dependencia operativa.

#### E. Activo operativo — 1–2× ingresos anuales o 2–4× EBITDA

**Aplica solo si hay clientes, ventas y contratos reales.** En ese caso, el software es un activo de soporte; el valor se calcula sobre el negocio, no sobre el código. Requiere estados financieros, due diligence contable y legal. Si no hay operación con clientes, este escenario no es aplicable.

### 5.3 Precio recomendado y mínimos

| Ancla | USD | COP (millones) | Cuándo usarla |
|---|---:|---:|---|
| **Mínimo absoluto** | 40.000 | 160 | As-is, sin garantía, sin exclusividad, comprador paga transferencia |
| **Mínimo recomendado** | 55.000 | 220 | As-is con 30 días de transición |
| **Objetivo as-is** | 65.000 | 260 | Comprador con equipo propio |
| **Objetivo terminado** | 105.000 | 420 | Empresa que quiere operar ya |
| **Objetivo llave en mano** | 150.000 | 600 | Empresa sin equipo técnico |
| **Aspiracional** | 180.000–220.000 | 720–880 | Comprador estratégico o white-label |

**Regla de decisión:**

- Si el comprador no acepta USD 55.000, no venda as-is: cierre los críticos y vuelva a ofrecer el escenario B. El coste de cierre (USD 20.000–35.000) se recupera con creces.
- Si el comprador ofrece menos de USD 40.000, prefiera licenciar o quedarse con el activo. Vender barato destruye la referencia de precio para futuras ventas.
- Si el comprador es estratégico y valora el ERP, no acepte menos de USD 130.000 sin una razón no monetaria (contrato de soporte, referencia, acceso a mercado).

### 5.4 Sensibilidad del precio

| Condición | Efecto sobre el objetivo “terminado” (USD 105.000) |
|---|---|
| Pruebas E2E + CI verde | +10–15% |
| ERP sincronizando con datos reales y monitoreado | +10–15% |
| 90 días de uptime >99,5% + monitoreo/alerting | +5–10% |
| Marca, dominio y datos incluidos con base legal | +10–20% |
| Sin despliegue productivo | −15–25% |
| Sin cesión de IP o licencia de IA dudosa | −20–30% |
| Comprador con equipo interno capaz de reconstruir | −10–20% |
| Comprador estratégico en el ecosistema Advantage | +20–40% |
| Venta a un solo retailer vs. white-label | −10–20% |

---

## 6. Negociación

### 6.1 Anclaje y BATNA

**Ancla de apertura:** USD 150.000 (llave en mano) o USD 130.000 (terminado), nunca USD 65.000.

**Argumento de ancla:** “El coste de reconstrucción con una fábrica es USD 285.000–680.000 y 10–14 meses. Lo que está sobre la mesa es un sistema en producción, con ERP resuelto, 10 superficies y documentación. El precio incluye el tiempo y el riesgo que usted no va a gastar.”

**BATNA del vendedor:** licenciar el producto a otro retailer del ecosistema Advantage, o seguir operándolo y venderlo como SaaS. No necesita vender a cualquier precio.

**BATNA del comprador:** construir, contratar una fábrica o comprar Shopify + integraciones. Su coste de construir es su techo; su tiempo de espera es su debilidad.

### 6.2 Paquetes y concesiones

| Paquete | Precio | Qué concede | Qué retiene |
|---|---:|---|---|
| A. Código | USD 65.000 | Repo, docs, 30 días | Marca, datos, soporte, exclusividad |
| B. Terminado | USD 105.000 | A + críticos + tests + 60 días de garantía | Marca, datos, soporte extendido |
| C. Llave en mano | USD 150.000 | B + despliegue + capacitación + 6 meses de soporte | Derecho de reventa del núcleo |
| D. Licencia | USD 30.000 + 3.000/mes | Uso, hosting, soporte | Código, derecho de reventa |
| Exclusividad | +20–30% | No revender el núcleo en el mismo mercado | — |
| Datos/marca | +10–20% | Marca, dominio, imágenes con derechos | Datos personales sin base legal |
| Soporte extra | USD 1.500–3.000/mes | 40 h/mes, SLA | Nuevas funcionalidades |

**Concesiones de bajo coste:** 30 días adicionales de transición, una sesión de capacitación, documentación de despliegue, lista de proveedores, carta de referencia. **Concesiones de alto coste:** exclusividad, código de los módulos genéricos, datos históricos, soporte ilimitado, nuevas funcionalidades.

### 6.3 Estructura de pago sugerida

| Hito | Porcentaje | Condición |
|---|---:|---|
| Firma | 30% | Contrato y NDA |
| Aceptación técnica | 40% | Checklist de la sección 3.4 cumplida |
| Entrega y transferencia | 30% | Repo, credenciales rotadas, IP cedida, 30 días de transición |

Alternativas: 25/50/25; escrow para el código y la IP; retención del 10% durante 60 días por defectos. Para licencia: implementación 50% al inicio, 50% al *go-live*; suscripción mensual o trimestral.

### 6.4 Cláusulas clave

- **Cesión de IP** solo con el pago total; licencia de uso mientras tanto.
- **Garantía** de 60 días por defectos del alcance vendido; no cubre nuevas funcionalidades.
- **Limitación de responsabilidad** al valor del contrato; exclusión de daños indirectos.
- **Confidencialidad** y no uso de datos del cliente.
- **Protección de datos** conforme a la Ley 1581 de 2012; acuerdo de tratamiento si hay acceso a datos.
- **Terceros:** el comprador asume las cuentas y licencias (Wompi, Google, Cloudinary, DeepSeek, ERP); el vendedor entrega la documentación de integración.
- **No competencia:** solo si se vende exclusividad; scope y tiempo limitados.
- **Soporte:** horas, canal, SLA y precio de horas extra.
- **Impuestos:** facturación, IVA/retención y moneda según la legislación colombiana.

### 6.5 Objeciones y respuestas

**“Lo hizo una IA, por eso vale menos.”**
> “Sí, se construyó con asistencia de IA y fue auditado por un programador. Eso explica por qué se produjo en 100 días, no por qué vale menos para usted. El coste de reconstrucción es USD 285.000–680.000; el descuento por riesgo ya está aplicado. Si quiere eliminar ese descuento, el escenario B incluye pruebas, auditoría y garantía.”

**“Shopify es más barato.”**
> “Shopify Plus cuesta USD 2.300–2.500/mes solo de plataforma, y sigue necesitando ERP Advantage, apps de reparto/picking, integración de pagos y reglas de negocio. Compare el TCO a 3 años, no el precio de lista. Además, Shopify no le da el código ni la integración con su ERP.”

**“No tiene tests.”**
> “Correcto. Por eso el escenario A tiene un descuento explícito y el B incluye 120 horas de pruebas de humo/E2E y 60 días de garantía. No escondemos la deuda; la cuantificamos.”

**“Nequi/PSE no funcionan.”**
> “Están en el backlog con un coste de cierre de USD 20.000–35.000. Se pueden cerrar antes de la venta o descontar del precio. En el escenario B quedan cerrados y probados.”

**“El ERP es viejo y descontinuado.”**
> “Es exactamente por eso que la integración vale: hay pocos proveedores que entiendan Advantage/TIDSAL. Si el comprador migra a otro ERP, el código de negocio y las 10 superficies siguen siendo reutilizables; la integración se reemplaza por un adaptador.”

**“Prefiero pagarte por horas.”**
> “Puedo facturar horas a USD 70–90/h, pero el resultado sería el mismo coste de reposición y usted asumiría el riesgo de coordinación. Comprar el activo le ahorra 8–10 meses y le da un sistema ya operando.”

**“No tengo equipo para mantenerlo.”**
> “Entonces el escenario C es el suyo: despliegue, capacitación y 6 meses de soporte. O el D: yo opero y usted paga suscripción.”

---

## 7. Argumentario de valor

### 7.1 Lo que el comprador evita

| Coste evitado | Valor aproximado |
|---|---|
| Descubrimiento y diseño de 10 superficies | USD 20.000–40.000 |
| Backend con 335 endpoints y 89 tablas | USD 80.000–150.000 |
| Tienda + admin + delivery + picking | USD 90.000–180.000 |
| 3 apps móviles | USD 60.000–130.000 |
| Integración ERP Advantage | USD 20.000–50.000 |
| Bot + IA | USD 10.000–25.000 |
| DevOps, seguridad, CI/CD, TLS, runbooks | USD 15.000–30.000 |
| Curva de aprendizaje del negocio | No cuantificable; 3–6 meses |
| **Total** | **USD 295.000–605.000** |

### 7.2 Time-to-market

- Reconstrucción: **10–14 meses** con un equipo de 5–6 personas.
- Compra del activo terminado: **30–60 días** de transición y despliegue.
- Ahorro: **8–12 meses** de tiempo de mercado, ventas y aprendizaje.

### 7.3 El foso del ERP

Advantage/Fortuner/TIDSAL es un ERP descontinuado, con ODBC exclusivo de Windows y un esquema legado que no está documentado públicamente. El repo incluye 92 archivos de integración y documentación específica (`INTEGRACION-ERP-ADVANTAGE.md`, `PLAN-INTEGRACION-ERP.md`, `COMPARACION-ESQUEMA-FORTUNER.md`, `TIDSAL-diccionario-datos.json`). Un competidor puede replicar la tienda; replicar el mapeo del ERP requiere acceso, tiempo y conocimiento del negocio.

### 7.4 Multi-superficie y operación

- 4 webs + 3 apps + 3 desktop + bot, con una sola base de datos y un solo backend.
- Delivery y picking no son “extras”: son las superficies que conectan la tienda con la operación real.
- La seguridad y el despliegue ya están resueltos; el comprador no empieza de cero.

### 7.5 Documentación y transferibilidad

- 7.828 líneas de documentación, con esquema de BD, seguridad, ERP, despliegue, CI/CD y runbooks.
- Un comprador puede auditar sin depender del vendedor; eso reduce el descuento por riesgo.
- La documentación es, en sí misma, un activo vendible: reduce el coste de *due diligence* y acelera la transición.

---

## 8. Cómo mitigar la objeción “lo hizo una IA”

1. **Auditoría independiente:** contrate a un programador senior que revise arquitectura, seguridad, deuda y licencias. Entregue el informe como anexo. Una auditoría de 40–60 horas cuesta USD 2.000–5.000 y puede subir el precio en USD 10.000–20.000.
2. **Pruebas de aceptación:** escriba pruebas de humo/E2E de los flujos críticos y muéstrelas en CI. No hace falta cobertura del 100%; sí demostrar que los flujos que generan dinero funcionan.
3. **Lista de limitaciones:** entregue el backlog con costes de cierre. La transparencia reduce el riesgo percibido y evita renegociaciones.
4. **Garantía y transición:** 60 días de garantía y 30 días de acompañamiento. El comprador paga por certeza, no solo por código.
5. **Propiedad intelectual:** declare las herramientas de IA usadas, confirme que sus términos permiten uso comercial y entregue una cesión de derechos con indemnidad. Si no puede garantizar la cadena de custodia, ofrezca un descuento o una auditoría de licencias.
6. **Licencias de terceros:** genere un inventario (`license-checker`, `pip-licenses`) y elimine dependencias con licencias incompatibles. Incluya atribuciones (OSM/ODbL, MapLibre/BSD, etc.).
7. **Escrow y transición:** ofrezca depositar el código en escrow y un período de transición remunerado. Reduce la percepción de riesgo y justifica el precio.
8. **Caso de uso real:** muestre producción, métricas, logs, capturas y un video de 10 minutos recorriendo los flujos. Un sistema que funciona convence más que un repositorio.

---

## 9. Riesgos legales y operativos

### 9.1 Propiedad intelectual y IA

- En Colombia, el software está protegido por el derecho de autor (Ley 23 de 1982, Ley 1915 de 2009 y Decisión Andina 351 de 1993). La titularidad de obras generadas con IA es un área gris; el contrato debe asignar derechos y garantizar que el vendedor tiene facultad para cederlos.
- Revise los términos de la herramienta de IA utilizada: uso comercial, propiedad del *output*, restricciones de entrenamiento y indemnidad.
- Garantice que no se copió código propietario de terceros (ERP, plantillas, librerías con licencias copyleft).
- Entregue un **inventario de licencias** y una **cláusula de indemnidad** con límite.

### 9.2 Protección de datos personales

- La plataforma trata datos de clientes (nombres, direcciones, teléfonos, correos, historial de compras, ubicación de repartidores). Aplica la **Ley 1581 de 2012** y el Decreto 1377 de 2013.
- Si se vende el código sin la base de datos, no transfiera datos personales. Si se vende la operación, necesita base legal, aviso de privacidad, autorización y acuerdo de tratamiento.
- Registre las bases de datos ante la SIC cuando corresponda; designe un responsable y un encargado.
- Minimice la retención y documente el ciclo de vida (recolección, uso, almacenamiento, eliminación).
- Si hay datos de salud, menores o financieros, refuerce controles y consentimientos.

### 9.3 Pagos y PCI

- Wompi/Epayco reducen el alcance de PCI si se usan campos alojados o redirección; **no almacene PAN/CVV**.
- Verifique que `customer_payment_methods` guarde tokens, no datos de tarjeta.
- Confirme el estado de la aprobación de la cuenta Wompi, las llaves de producción y los webhooks.
- Nequi/PSE deben probarse con montos reales y conciliación antes de vender “terminado”.

### 9.4 ERP y dependencias

- Advantage es un producto descontinuado; el driver ODBC es solo Windows y la licencia es del cliente.
- El comprador debe tener acceso al ERP, licencia ADS y un plan de continuidad (migración o soporte de terceros).
- Si el VPS es Windows, el puente ODBC funciona; si se migra a Linux, necesita un *bridge* Windows o reescribir la integración.
- Documente el esquema y los significados (TIDSAL, DOMDIA, DOMITE) para reducir la dependencia.

### 9.5 Licencias y atribuciones de terceros

- **OpenStreetMap/ODbL:** atribución y *share-alike* para bases derivadas; revise el uso de datos de OSRM/Nominatim.
- **Nominatim:** política de uso (1 req/s, user-agent identificable, caché).
- **MapLibre/Leaflet:** BSD; conserve avisos.
- **Google OAuth, Wompi, Epayco, Cloudinary, Resend, DeepSeek:** términos de servicio y límites de uso; no se transfieren automáticamente con el código.
- **Imágenes de producto:** derechos del proveedor o del retailer; no se incluyen salvo cesión expresa.
- **Marca “Mercaldas”:** registrada o no, es un activo del titular; su uso por el comprador requiere autorización.

### 9.6 Riesgos operativos y de continuidad

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Bus factor 1 | Alto | Documentación, transición, soporte, contrato de continuidad |
| Sin tests automatizados | Alto | Pruebas E2E, CI, auditoría |
| Windows + WSL + Docker + portproxy | Medio | Runbook, tarea de arranque, monitoreo, migración a Linux |
| Una sola instancia | Medio | Healthchecks, backups, plan de escalado |
| Rate limit en memoria | Bajo | Redis si se escala; documentar |
| Sin WAF dedicado | Medio | Rate limit + CSP + proxy reverso; evaluar Cloudflare/WAF si crece el tráfico o la exposición |
| Sin backups automáticos | Alto | Programar `pg_dump`, probar restauración, off-site |
| Sin monitoreo/alerting | Medio | Uptime, logs, métricas, alertas |
| Secretos en `.env` | Medio | Rotación, gestor de secretos, permisos |
| Dependencia de Wompi/Google/ERP | Medio | Plan B de pagos, Adaptador ERP, contratos |
| Datos personales | Alto | Política, consentimientos, seguridad, DPA |

### 9.7 Riesgos comerciales

- **Tracción no demostrada:** si no hay clientes/ventas, el comprador no paga por tracción; paga por coste evitado. El precio es menor que el de un negocio operando.
- **Competencia de Shopify/WooCommerce:** el comprador puede preferir SaaS; el argumento es el ERP y la operación, no el código.
- **Replicabilidad con IA:** un competidor puede reconstruir la tienda en meses; el foso es el ERP, los datos y la operación, no las líneas de código.
- **Marca no incluida:** el comprador puede necesitar licencia de marca; si no se incluye, el precio baja.
- **Dependencia del vendedor:** si el comprador percibe que no puede operar sin el vendedor, descuenta o no compra.

### 9.8 Tributario y contractual

- La venta de software en Colombia puede causar IVA, retención en la fuente e ingreso ordinario o ganancia ocasional, según la estructura (venta de activo, licencia o servicios). Consulte un contador antes de fijar el precio neto.
- Si la venta es al exterior, revise exportación de servicios, facturación en USD, repatriación de divisas y tratados de doble tributación.
- Defina si el precio incluye impuestos, quién paga la transferencia bancaria y en qué moneda se liquida.
- Para una licencia recurrente, separe implementación, suscripción y soporte en el contrato y en la factura.

---

## 10. Recomendaciones antes de vender

### 10.1 Plan de 90 días

| Periodo | Acciones | Resultado |
|---|---|---|
| **Días 0–30** | Congelar alcance; auditar seguridad/dependencias; cerrar PAG-01/02/03, PRD-01, CTA-01, GEN-01; rotar secretos; escribir “known issues”; preparar demo | Producto “terminado” y transparente |
| **Días 31–60** | Pruebas E2E de flujos críticos; CI con tests; prueba de backups/restauración; monitoreo/alerting; actualizar docs; auditoría de licencias; cesión de IP | Riesgo reducido y evidencia |
| **Días 61–90** | Data room; video demo; tres cotizaciones de fábricas para anclar el precio; contacto con compradores estratégicos; negociación; plan de transición | Venta o licencia firmada |

**Vía rápida (4–6 semanas):** cerrar los 6 críticos, añadir pruebas de humo, preparar “known issues” y auditoría. Es suficiente para el escenario B.

### 10.2 Data room mínimo

- Repositorio (lectura) e historial de commits.
- Arquitectura y diagrama de despliegue.
- Esquema de BD (`docs/DATABASE.md`) y diccionario ERP.
- Documento de seguridad (`docs/SECURITY.md`) y análisis de riesgos residuales.
- Runbook de despliegue y recuperación.
- Backlog con costes de cierre.
- Evidencia de pruebas (logs, capturas, scripts).
- Métricas de uptime y rendimiento (si existen).
- Contratos y cuentas de terceros.
- Cesión de IP de colaboradores.
- Inventario de licencias.
- Estados financieros (solo si se vende el activo operativo).

### 10.3 Qué arreglar y qué declarar

**Arreglar antes de vender:**

- Nequi/PSE (si se vende “terminado”).
- Inventario (si se vende “terminado”).
- Rastreo real (si se vende “terminado”).
- Especificaciones de producto (si se vende “terminado”).
- Llave de Wompi y prueba de cobro.
- Secretos rotados y fuera del repo.
- Pruebas de humo/E2E.
- Backup/restauración probados.

**Declarar con descuento:**

- Falta de tests automatizados (si no se alcanza a cubrir).
- Deuda de admin/móviles no auditada.
- Infraestructura Windows/WSL.
- Dependencia del ERP descontinuado.
- Marca/datos no incluidos.
- Cualquier funcionalidad no probada en producción.

### 10.4 Secuencia de precio

1. **Ancle** con el coste de reposición (USD 285.000–680.000) y el escenario llave en mano (USD 150.000).
2. **Ofrezca** el escenario B (USD 105.000) como “el precio para que esto quede operando sin sorpresas”.
3. **Conceda** el escenario A (USD 65.000) solo si el comprador renuncia a garantía, soporte y exclusividad.
4. **Reserve** el escenario C (USD 150.000) para compradores sin equipo técnico.
5. **No baje** de USD 55.000 sin una contraprestación no monetaria (referencia, caso de estudio, contrato de soporte, acceso a mercado).

---

## 11. Anexos

### A. Valor de reposición por módulo (referencia, no precio de venta)

Calculado sobre el coste de reposición central (USD 460.800) y la participación de cada módulo en el esfuerzo. Redondeado.

| Módulo | Participación | USD |
|---|---:|---:|
| Backend núcleo | 18,75% | 86.000 |
| Backend operativo | 9,38% | 43.000 |
| Backend comercial | 6,25% | 29.000 |
| Tienda web | 7,81% | 36.000 |
| Admin web | 9,38% | 43.000 |
| Paneles delivery/picking | 5,47% | 25.000 |
| Apps móviles | 10,16% | 47.000 |
| Escritorio Electron | 2,34% | 11.000 |
| Bot | 3,52% | 16.000 |
| ERP Advantage | 7,81% | 36.000 |
| DevOps/seguridad | 5,08% | 23.000 |
| QA/gestión | 7,81% | 36.000 |
| UX/UI/diseño | 6,25% | 29.000 |
| **Total** | **100%** | **460.000** |

> Si el comprador quiere solo una parte (p. ej., la tienda + backend, sin apps), use esta tabla como referencia y aplique el factor de comercialización correspondiente. No venda módulos sueltos sin un contrato de licencia y sin proteger el núcleo.

### B. Backlog resumido

| Severidad | Cantidad | Ejemplos |
|---|---:|---|
| Alta | 6 | Nequi, PSE, inventario, specs, rastreo, Wompi key |
| Media | 7 | Factura, notificaciones, direcciones, cupones en checkout, métodos guardados, Bre-B, sección de cupones |
| Baja | 3 | Diálogos nativos, reseñas, código muerto |

El detalle está en `docs/informe-pendientes.md`. **No cubre admin, delivery, picking ni móviles.**

### C. Fuentes y referencias

| Fuente | Uso | Fecha | Confianza |
|---|---|---|---|
| `index.dev/blog/latam-developer-hourly-rates` | Tarifas freelance LatAm | 2026-10-22 | Media |
| `curotec.com/insights/latam-developer-hourly-rates-in-2025` | Tarifas LatAm | 2026-10-22 | Media |
| `devnearshore.com/nearshore-software-development-cost` | Tarifas nearshore | 2026-10-22 | Media |
| `shopify.com/plus/pricing` | Benchmark SaaS | 2026-10-22 | Alta |
| `shopify.com/blog/ecommerce-website-cost` | Coste de ecommerce custom | 2026-10-22 | Media |
| `buildfire.com/how-much-does-it-cost-to-make-an-app` | Coste de apps | 2026-10-22 | Baja |
| Estimaciones del evaluador | ERP, salarios, ecommerce integral | 2026-10-22 | Baja |

**No accesibles:** `arc.dev`, `accelerance.com`, `simform.com`, `webfx.com`, `getonbrd.com`, `integrate.io`, `netsuite.com`, `paylab.com`, `talent.com`, Upwork, DesignRush, Codica. No se usaron como dato.

### D. Supuestos y limitaciones

- **TRM:** COP 4.000/USD. Si la TRM cambia, ajuste las cifras en COP proporcionalmente.
- **Estado del repo:** rama `dev`, 429 commits. El inventario refleja el árbol de trabajo al 22 de octubre de 2026, que incluye cambios locales sin commitear; el conteo de commits es 429.
- **Producción:** se asume que `mercaldas.jcti.xyz` funciona según lo reportado; no se auditaron servidores, cuentas ni bases de datos para este documento.
- **Auditoría:** el backlog cubre solo la tienda web; el resto de superficies no fue auditado a fondo.
- **IA:** se toma como cierto que el código fue generado con asistencia de IA y auditado por un programador, según lo indicado por el propietario. No se auditó la cadena de custodia de cada línea.
- **Tarifas:** son rangos de mercado, no cotizaciones. La valoración es una estimación de negociación, no una tasación certificada.
- **Alcance:** excluye el CRM, la marca, los datos, la infraestructura y las cuentas de terceros, salvo que se indique.

### E. Glosario

- **PM:** persona-mes de 160 horas.
- **LOC:** líneas de código.
- **As-is:** venta del activo tal como está, sin garantía ni cierre de deuda.
- **Terminado:** cumple la checklist de la sección 3.4.
- **Llave en mano:** incluye despliegue, capacitación, soporte y cesión de IP.
- **White-label:** licencia del núcleo para que otro retailer lo opere con su marca.
- **Reposición:** coste de reconstruir el producto desde cero con un equipo profesional.
- **Valor ajustado:** reposición menos descuentos por riesgo y deuda.
- **BATNA:** mejor alternativa a un acuerdo negociado.

---

## 12. Conclusión

Mercaldas Ecommerce es un activo valioso, pero **no por la cantidad de código**: por el tiempo, la integración con el ERP y la operación ya resuelta. Su precio justo depende del comprador:

- **Si el comprador es una empresa con equipo técnico y prisa:** USD 55.000–85.000 as-is, o USD 90.000–130.000 terminado.
- **Si el comprador no tiene equipo:** USD 130.000–180.000 llave en mano.
- **Si el comprador es estratégico (ERP/white-label):** USD 180.000–220.000 o licencia recurrente.
- **Si no hay comprador:** no venda barato; licencie, opere o espere. El activo no se deprecia tan rápido como un producto de consumo, aunque la deuda y las dependencias envejecen; el mercado de ERP legado sigue necesitando integradores.

La recomendación final es **invertir 4–6 semanas en cerrar los críticos, añadir pruebas de humo y preparar el data room**, y luego vender el escenario B a USD 105.000. Es el mejor equilibrio entre esfuerzo, riesgo y precio. Si el objetivo es maximizar el valor a largo plazo, convierta el núcleo en **white-label para el ecosistema Advantage**: el mismo código, varias implementaciones, ingresos recurrentes y un foso que la IA no replica fácilmente.

---

*Fin del documento. Versión 1.0 · 22 de octubre de 2026.*
