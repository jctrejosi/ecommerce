# Informe de funcionalidades faltantes y bugs — Cliente web

> **Alcance:** `Interface web client` (tienda). El panel admin y las interfaces
> móviles quedan para una inspección posterior.
> **Estado:** inspección inicial (continúa). Última actualización: primera pasada
> **Método:** lectura de componentes + `grep` de patrones de código muerto
> (`onClick` vacíos, `href="#"`, `MOCK_*`, datos hardcodeados, `window.alert`).
> **Verificación:** cada hallazgo trae evidencia `archivo:línea`. Los que dicen
> *(verificado)* se reprodujeron contra el código en esta sesión.

## Cómo vamos a trabajarlo

1. Se elige **un ítem** del backlog (por prioridad).
2. Se corrige y se valida (build + prueba real cuando aplique).
3. Se marca **✅ Hecho** en la tabla y así se pasa al siguiente.

El **manual** (`docs/manual-cliente/`) se reanuda al **final**, cuando estos
arreglos estén aplicados.

---

## Backlog priorizado

| ID | Área | Hallazgo | Tipo | Sev. | Esfuerzo | Estado |
|---|---|---|---|---|---|---|
| PAG-01 | Pagos | Nequi no procesa el pago (stub) | Faltante | Alta | M | ⬜ |
| PAG-02 | Pagos | PSE no crea transacción (stub) | Faltante | Alta | M | ⬜ |
| PAG-03 | Pagos | El pedido no reserva/descuenta inventario | Bug | Alta | M | ⬜ |
| PRD-01 | Producto | Detalle usa especificaciones y descripción **inventadas** | Bug | Alta | S | ⬜ |
| CTA-01 | Cuenta | El "rastreo" es **mock** y botones de llamar/mensaje sin handler | Faltante | Alta | M | ⬜ |
| GEN-01 | General | `WOMPI_PRIVATE_KEY` vacía → tarjeta no cobra al confirmar | Config | Alta | S | ⬜ |
| CTA-02 | Cuenta | "Descargar factura" y "Reportar problema" sin handler | Faltante | Media | S | ⬜ |
| CTA-03 | Cuenta | Notificaciones: marcar todas / eliminar / preferencias **no persisten** | Bug | Media | S | ⬜ |
| CTA-04 | Cuenta | Editar dirección: el lápiz no hace nada | Faltante | Media | S | ⬜ |
| PAG-04 | Pagos | No hay cupones en el checkout | Faltante | Media | M | ⬜ |
| PAG-05 | Pagos | Los métodos de pago guardados no se usan al pagar | Faltante | Media | M | ⬜ |
| PAG-06 | Pagos | Bre-B: la confirmación depende del admin, sin aviso automático | Parcial | Media | M | ⬜ |
| CTA-05 | Cuenta | Sección de cupones referenciada pero no renderizada | Faltante | Media | S | ⬜ |
| CTA-06 | Cuenta | `window.confirm` / `window.alert` nativos | UX | Baja | S | ⬜ |
| PRD-02 | Producto | Sin reseñas de producto | Faltante | Baja | L | ⬜ |
| CTA-07 | Cuenta | Código muerto (`MOCK_*`, `INIT_*`, `LOYALTY_HISTORY`, `FAQ_ITEMS`) | Limpieza | Baja | S | ⬜ |

Severidad: Alta = impide una operación o muestra datos falsos · Media = función
incompleta o incoherente · Baja = cosmético/limpieza.
Esfuerzo: S ≈ < 1 h · M ≈ 1 sesión · L ≈ varias sesiones.

---

## Detalle

### PAG-01 — Nequi no procesa el pago · Faltante · Alta
- **Síntoma:** al elegir Nequi, el pedido queda en `payment_pending`; no se abre
  la app de Nequi ni se cobra. El cliente solo escribe su número.
- **Evidencia:** `backend/src/modules/orders/orders.service.ts:257` — la
  transacción del proveedor se crea **solo** si `paymentMethod === 'tarjeta'`.
  UI engañosa en `Interface web client/src/app/components/CheckoutModal.tsx:1253`
  ("Tu pedido está siendo procesado por Wompi").
- **Arreglo propuesto:** crear `WompiService.createNequiTransaction()` (Wompi
  soporta Nequi por *push*: `payment_method.type = NEQUI` + `phone_number`) y
  llamarlo desde `createOrder`. Reutilizar `PaymentVerificationService` para
  confirmar y notificar.

### PAG-02 — PSE no crea transacción · Faltante · Alta
- **Síntoma:** PSE guarda banco y tipo de persona, pero no redirige ni cobra.
- **Evidencia:** mismo punto que PAG-01; `psePayment` solo viaja como
  `paymentDetails` y no se usa para crear transacción.
- **Arreglo propuesto:** crear transacción PSE con Wompi (redirect) y manejar el
  retorno.

### PAG-03 — El pedido no reserva/descuenta inventario · Bug · Alta
- **Síntoma:** se puede vender más que el stock; `inventory` no cambia al crear
  el pedido.
- **Evidencia:** `orders.service.ts` (transacción de `createOrder`, ~317-470)
  inserta en `customer_addresses`, `orders`, `order_items`, `shipments`,
  `payment_intents`, `payments`, `order_status_history` — **no** toca `inventory`
  ni reservas. (verificado)
- **Arreglo propuesto:** validar stock al crear y actualizar `inventory`
  (y/o `inventory_reservations`) dentro de la misma transacción.

### PRD-01 — Detalle de producto con datos inventados · Bug · Alta
- **Síntoma:** las especificaciones y la descripción del producto no son del
  producto real; son plantillas por categoría.
- **Evidencia:** `Interface web client/src/app/ProductDetailModal.tsx:6`
  (`MOCK_SPECS`), `:109` (`MOCK_DESCRIPTIONS`), usadas en `:100` y `:193`;
  p. ej. "Registro: RSA-F-0012345", "País de origen: Colombia" fijos. No lee
  `product.description`.
- **Arreglo propuesto:** usar los campos reales del producto (descripción y
  atributos) y, si no hay, no mostrar especificaciones inventadas.

### CTA-01 — Rastreo mock + botones sin handler · Faltante · Alta
- **Síntoma:** la sección de rastreo muestra repartidor ("Diego Martínez"),
  sucursal, calificación (4.9) y ETA (4:50 pm) fijos; los iconos de llamar y
  mensaje no hacen nada.
- **Evidencia:** `Interface web client/src/app/Views/AccountView/index.tsx`
  (bloque `TrackingSection`, ~1942-2102); botones en `:2035` y `:2038` sin
  `onClick`. (verificado)
- **Arreglo propuesto:** conectar a datos reales de `delivery_assignments` /
  `delivery_driver_locations` (ya existen) o, como mínimo, no mostrar datos
  ficticios.

### GEN-01 — `WOMPI_PRIVATE_KEY` vacía · Config · Alta
- **Síntoma:** la config pública de Wompi carga, pero el cobro con tarjeta falla
  al confirmar.
- **Evidencia:** `backend/.env.development.local` → `WOMPI_PRIVATE_KEY` longitud
  **0**; `wompi.service.ts` exige la private key para crear la transacción.
- **Arreglo propuesto:** cargar la private key (o dejar Wompi deshabilitado,
  ahora la validación del admin lo bloquea con un mensaje claro).

### CTA-02 — Botones sin handler en el detalle del pedido · Faltante · Media
- **Evidencia:** `AccountView/index.tsx:1681` y `:1687` → `onClick: () => {}`
  ("Descargar factura", "Reportar problema"). (verificado)
- **Arreglo propuesto:** implementar la descarga de factura (PDF) y un canal para
  reportar problemas, o retirarlos si no van.

### CTA-03 — Notificaciones que no persisten · Bug · Media
- **Síntoma:** "Marcar todas como leídas", eliminar y las preferencias solo
  cambian el estado local; al recargar vuelven.
- **Evidencia:** `AccountView/index.tsx:3742` (marcar todas → `setReadNotifIds`),
  `:3787` (preferencias → `setPrefs`), `:3863` (eliminar →
  `setDeletedNotifIds`). El backend solo tiene `GET /notifications` y
  `POST /notifications/:id/read`. (verificado)
- **Arreglo propuesto:** endpoints para "marcar todas", eliminar y guardar
  preferencias (o quitar las acciones que no persisten).

### CTA-04 — Editar dirección sin handler · Faltante · Media
- **Evidencia:** `AccountView/index.tsx:2933` (lápiz sin `onClick`). El backend ya
  tiene `PUT /customer-auth/addresses/:id`. (verificado)
- **Arreglo propuesto:** reutilizar el formulario de alta en modo edición.

### PAG-04 — Sin cupones en el checkout · Faltante · Media
- **Evidencia:** `CheckoutModal.tsx` no tiene campo de cupón; en el backend
existen las tablas `coupons` y el módulo `promotions` (solo para admin,
`admin-promotions.controller.ts`), pero **no hay endpoint para aplicar un cupón**
desde el checkout. (verificado)
- **Arreglo propuesto:** campo "código de descuento" + validación y aplicación al
  total.

### PAG-05 — Métodos de pago guardados sin uso · Faltante · Media
- **Síntoma:** se guardan tarjeta/Nequi en "Mi cuenta", pero el checkout no los
  ofrece.
- **Evidencia:** `customer_payment_methods` (CRUD) no se consulta en
  `placeOrder` (`App.tsx:698`).
- **Arreglo propuesto:** listar los métodos guardados en el paso de pago.

### PAG-06 — Bre-B sin confirmación automática · Parcial · Media
- **Evidencia:** `CheckoutModal.tsx:1116` (muestra llave/QR); el pedido queda
  `payment_pending` y depende de que el admin verifique.
- **Arreglo propuesto:** avisar al cliente cuando el admin confirme (notificación)
  y/o validar por webhook.

### CTA-05 — Cupones referenciados pero no renderizados · Faltante · Media
- **Evidencia:** `AccountView/index.tsx:677` (`INIT_COUPONS`) y `:1113`
  (`coupons`) nunca se renderizan. (verificado)
- **Arreglo propuesto:** implementar la sección de cupones o eliminar el mock.

### CTA-06 — Diálogos nativos · UX · Baja
- **Evidencia:** `AccountView/index.tsx:3081` (`window.confirm`) y `:3169`
  (`window.alert`).
- **Arreglo propuesto:** usar el modal/toast del sitio.

### PRD-02 — Sin reseñas de producto · Faltante · Baja
- **Evidencia:** no hay reseñas en `ProductDetailModal.tsx` (el tipo
  `rating/text/date/helpful` de `AccountView:515` está sin uso).
- **Arreglo propuesto:** modelo + endpoints + UI, o dejarlo fuera de alcance.

### CTA-07 — Código muerto · Limpieza · Baja
- **Evidencia:** `AccountView/index.tsx:522` `MOCK_ACCT_ORDERS` (solo usado para el
  tipo en `:601`), `:605` `INIT_FAVORITES`, `:609` `INIT_LISTS`, `:803`
  `LOYALTY_HISTORY`, `:820` `FAQ_ITEMS`; tipo de reseñas `:515`. (verificado)
- **Arreglo propuesto:** eliminar los que no se vayan a usar.

---

## Metodología y cobertura

- **Greps aplicados al cliente:** `onClick` vacíos, `href="#"`, `TODO/FIXME/mock`,
  arrays literales, `window.alert/confirm`, `disabled` estáticos, servicios
  (`*Service.`), y búsqueda de cupones/reseñas.
- **Falso positivo aclarado:** los `href="#"` del `Header`
  (`Header.tsx:387,443,832`) **no** son bugs: hacen `e.preventDefault()` y llaman
  `onHome()`.
- **Pendiente de inspeccionar a fondo:** `LandingView` y sus secciones
  (`HeroSection`, `DailyDealsSection`, `FeaturedProductsSection`,
  `QuickCategoriesSection`, `SucursalesSection`, `NewsletterSection`),
  `CatalogView` (filtros/orden/paginación), `CartDrawer`, `NotificationsDropdown`,
  `PopupDisplay`, y `ChatbotWidget` (bot Daisy).
