# Manual de uso — Cliente (tienda web Mercaldas)

Documentación funcional del cliente web (`Interface web client`): **cada
control** que un usuario puede accionar (botones, inputs, selects, toggles,
atajos de teclado) queda mapeado al efecto que produce, terminando siempre en
**el cambio en la base de datos**.

Objetivo: que cualquiera pueda reproducir y verificar una operación completa del
cliente de principio a fin, sabiendo exactamente qué botón toca, qué endpoint se
dispara y qué tabla se escribe.

> **Estado del proyecto del manual (para reanudar).** El manual quedó **pausado**
> a propósito: primero se hace el **informe de pendientes y bugs**
> (`docs/informe-pendientes.md`) y se corrigen los faltantes; el manual se
> reanuda **al final**, cuando lo documentado ya refleje el comportamiento
> definitivo. Ya están hechas las secciones **06** y **07**. Para continuar, basta
> con seguir el mapa de abajo por el siguiente `⬜`.

---

## Convenciones

- **Un control = una fila.** Si un botón abre un modal, el modal tiene su propia
  subsección; no se anidan en la misma fila.
- La última columna de cada mapeo es **Efecto en BD** (el punto final). Si el
  control no toca la BD, va `—`.
- **Endpoint / servicio** cita el llamado exacto (`POST /orders/checkout`) o la
  función del servicio del cliente (`ordersService.checkout`), con su archivo.
- Los estados de funcionalidad usan: `✅ Implementado`, `🟡 Parcial`,
  `⬜ No implementado`.
- Los estados de documentación usan: `✅ Documentado`, `🟡 En progreso`,
  `⬜ Pendiente`.
- Cuando el control solo mueve estado local (React) y no persiste nada, se dice
  explícitamente.

### Plantilla de sección

```markdown
# NN. <Área de operación>

> **Componentes:** `ruta/al/componente.tsx`
> **Ruta(s):** `/ruta`, `/otra?tab=x`
> **Estado:** ✅ Documentado

## Propósito

<Qué resuelve esta área para el usuario, en 2-4 líneas.>

## Funcionalidades implementadas

| Funcionalidad | Estado | Notas |
|---|---|---|
| ... | ✅ | ... |

## Mapeo botón por botón

### <Sub-bloque> (p. ej. "Paso 1 — Resumen")

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | "Continuar..." | Botón | ... | Avanza a paso 2 | — (estado local) | — |

## Efectos en base de datos (resumen)

| Tabla | Cuándo | Columnas clave |
|---|---|---|
| `orders` | al confirmar | `status`, `total`, ... |

## Pendientes / huecos

- ...
```

---

## Mapa de secciones

| # | Sección | Componentes principales | Estado |
|---|---|---|---|
| 01 | Estructura y navegación | `Header.tsx`, `Footer.tsx`, `PopupDisplay.tsx`, `Logo.tsx` | ⬜ |
| 02 | Inicio (landing) | `LandingView`, `HeroSection`, `QuickCategoriesSection`, `DailyDealsSection`, `FeaturedProductsSection`, `PromoBanner`, `AdvertisingBanner`, `BrandsSection`, `BenefitsSection`, `NewsletterSection`, `SucursalesSection` | ⬜ |
| 03 | Catálogo | `CatalogView` (filtros, orden, búsqueda, infinite scroll, tarjetas) | ⬜ |
| 04 | Detalle de producto | `ProductDetailModal.tsx` | ⬜ |
| 05 | Carrito | `CartDrawer.tsx` | ⬜ |
| **06** | **Checkout y métodos de pago** | `CheckoutModal.tsx`, `CheckoutAddressMap.tsx` | **✅ Documentado** |
| 07 | Cuenta y autenticación | `AccountView` (perfil, direcciones, pedidos, notificaciones, favoritos), `AuthModal.tsx`, `SocialAuthButtons.tsx` | ✅ Documentado |
| 08 | Seguimiento de pedidos | `OrdersPanel.tsx`, `OrderTrackingModal.tsx`, `LiveOrderMap.tsx`, `OrderChatWidget.tsx`, `OrderChatConversation.tsx` | ⬜ |
| 09 | Notificaciones | `NotificationsDropdown.tsx` | ⬜ |
| 10 | Asistente de compras (Daisy) | `ChatbotWidget.tsx` (+ `bot/`) | ⬜ |
| 11 | Búsqueda y otros modales | `AddressModal.tsx`, `ErrorPage.tsx`, `ErrorBoundary.tsx` | ⬜ |

### Archivos de sección

| Sección | Archivo |
|---|---|
| 06 | `docs/manual-cliente/06-checkout.md` |
| 07 | `docs/manual-cliente/07-cuenta-y-auth.md` |

El resto sigue la convención `docs/manual-cliente/NN-<slug>.md`.

---

## Globales del cliente (contexto común)

Estos valores afectan a varias operaciones y se documentan una vez aquí.

| Elemento | Fuente | Notas |
|---|---|---|
| `VITE_API_URL` | `Interface web client/.env` | Base del backend NestJS (`:3000` en local) |
| `VITE_BOT_API_URL` | idem | Base del bot FastAPI (`:8000`) |
| `VITE_GOOGLE_CLIENT_ID` | idem | Login con Google (OAuth) |
| Origen real de las imágenes | Cloudinary (`media`, `product_images`) | vía API del backend |
| Carrito del sitio | `localStorage` (`cart`) | Distinto del carrito del bot |
| Sesión de cliente | cookie/JWT (`customer-auth`) | `useAuth`/`customer` en `App.tsx` |
| Sesión del bot | `localStorage` (`session_id` uuid) | Carrito de invitado del bot |
