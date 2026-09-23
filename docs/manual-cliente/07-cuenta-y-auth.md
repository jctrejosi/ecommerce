# 07. Cuenta y autenticación

> **Componentes:** `Interface web client/src/app/Views/AccountView/index.tsx`,
> `Interface web client/src/app/components/AuthModal.tsx`,
> `Interface web client/src/app/SocialAuthButtons.tsx`
> **Servicio:** `Interface web client/src/services/customer-auth.service.ts`
> (`customerAuthService`, `customerAddressService`, `customerPaymentService`)
> **Ruta(s):** `/account?tab=<sección>`
> **Estado:** ✅ Documentado

## Propósito

Concentrar todo lo que el cliente registrado gestiona sobre su cuenta: pedidos,
favoritos, listas de compras, historial, direcciones, métodos de pago,
notificaciones y datos de perfil. También cubre el **alta/ingreso** al sitio
(`AuthModal`) con correo o Google.

`AccountView` es un contenedor con un *router* interno de subsecciones
(`renderSection`, línea 4330). El estado de datos (`orders`, `favorites`,
`addresses`, `payments`, `notifications`) vive en `AccountView` y cada
subsección lee/escribe su parte de la API.

## Funcionalidades implementadas

| Funcionalidad | Estado | Notas |
|---|---|---|
| Registro e ingreso con correo | ✅ | `customers` + sesión JWT |
| Ingreso con Google (OAuth) | ✅ | Requiere `VITE_GOOGLE_CLIENT_ID` y orígenes autorizados |
| Perfil: nombre, celular, email, contraseña | ✅ | `PUT /customer-auth/me` |
| Cerrar sesión | ✅ | Revoca tokens |
| Eliminar cuenta | ✅ | Borrado lógico de `customers` |
| Direcciones (CRUD + predeterminada) | ✅ | La 1ª queda predeterminada |
| Métodos de pago guardados (tarjeta/Nequi) | ✅ | Tarjeta se **tokeniza** en Wompi; no se guarda el número |
| Favoritos (ver/quitar) | ✅ | `/catalog/favorites` |
| Listas de compras (CRUD) | ✅ | `/catalog/shopping-lists` |
| Listado de pedidos + filtros + búsqueda | ✅ | Los filtros son locales |
| Historial de compras | ✅ | Derivado de pedidos + búsqueda local |
| Notificaciones (listar, marcar una leída) | 🟡 | Marcar **todas** y eliminar son **solo locales** |
| Preferencias de notificación | ⬜ | Los toggles no se guardan |
| Detalle de pedido: "Descargar factura" / "Reportar problema" | ⬜ | Botones sin handler |
| Rastreo del pedido | ⬜ | **Datos mock** (repartidor, ETA y mapa fijos) |
| Editar dirección | ⬜ | El lápiz no tiene handler; solo crear/borrar/predeterminar |

## Navegación y estructura

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | Botón volver (flecha) | Botón | Salir de la cuenta | `onBack` | — | — |
| 2 | Menú lateral (Mis Pedidos, Favoritos, Listas, Historial, Direcciones, Métodos de Pago, Notificaciones, Configuración) | Botones | Cambiar subsección | `navigate(id)` | — (estado local) | — |
| 3 | Botón de menú (móvil) | Botón | Abrir navegación | `setMobileNavOpen` | — | — |
| 4 | Cerrar sesión (desde menú/nav) | Botón | Salir | `handleLogout` | `POST /customer-auth/logout` | `customer_refresh_tokens` (revoca) |

> "Métodos de Pago" solo aparece si la tienda tiene al menos un método habilitado
> (`GET /payments/methods`).

---

## 7.1 Autenticación (`AuthModal.tsx` + `SocialAuthButtons.tsx`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | Overlay / X | Botón | Cerrar modal | `onClose` | — | — |
| 2 | "Iniciar sesión" (vista choice) | Botón | Ir a login | `onSetModalView("login")` | — | — |
| 3 | "Crear cuenta gratis" (choice) | Botón | Ir a registro | `onSetModalView("register")` | — | — |
| 4 | "Iniciar sesión con Google" | Botón | OAuth Google | `useGoogleLogin` → `userinfo` → `socialLogin("google", token, {…})` | `POST /customer-auth/social-login` | `customers` (crea/actualiza), `customer_refresh_tokens` (sesión) |
| 5 | Inputs correo y contraseña (login) | Inputs | Credenciales | Submit del form | `POST /customer-auth/login` (`customerAuthService.login`) | `customer_refresh_tokens` (insert) |
| 6 | Submit "Iniciar sesión" | Botón | Entrar | `onLoginSubmit` | ídem (5) | ídem (5) |
| 7 | "Regístrate gratis" | Botón | Cambiar a registro | `onSetModalView("register")` | — | — |
| 8 | Inputs Nombre, Apellido, Correo, Celular, Contraseña (registro) | Inputs | Alta | Submit del form | `POST /customer-auth/register` (`customerAuthService.register`) | `customers` (insert); `newsletter_subscribers` si acepta marketing |
| 9 | Submit "Crear mi cuenta" | Botón | Crear | `onRegisterSubmit` | ídem (8) | ídem (8) |
| 10 | "Inicia sesión" | Botón | Volver a login | `onSetModalView("login")` | — | — |
| 11 | "¿Olvidaste tu contraseña?" / "Términos de uso" / "Privacidad" | Enlaces | Informativos | `href="#"` (sin acción) | — | — |

> Si falta `VITE_GOOGLE_CLIENT_ID`, el botón de Google se muestra **deshabilitado**
> con un `title` explicativo (no rompe).

## 7.2 Mis Pedidos (`OrdersSection`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | Input "Buscar por número de pedido…" | Input | Filtrar | `setSearch` (local) | — | — |
| 2 | Filtros: Todos / Preparando / Listo / En camino / Entregado / Cancelado | Botones | Filtrar por estado | `setFilter` (local) | — | — |
| 3 | "Ver detalle" | Botón | Abrir detalle | `navigate("order-detail")` | — | — |
| 4 | "Rastrear pedido" (solo *en camino*) | Botón | Ver mapa | `onOpenTracking(id)` o `navigate("tracking")` | — | — |
| 5 | "Comprar de nuevo" (entregado/cancelado) | Botón | Reponer | `order.items.forEach(onAdd)` | — (carrito local) | — |

Los pedidos se leen con `ordersService` (caché en `AccountView`) y se refrescan
en vivo con `useCustomerOrderEvents` (WebSocket).

## 7.3 Detalle del pedido (`OrderDetailSection`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | "Volver" | Botón | Regresar | `navigate("orders")` | — | — |
| 2 | "Ver mapa en vivo" | Botón | Seguimiento | `onOpenTracking(id)` | — | — |
| 3 | "Comprar de nuevo" | Botón | Reponer | `order.items.forEach(onAdd)` | — | — |
| 4 | "Descargar factura" | Botón | Factura | `onClick: () => {}` (**sin handler**) | — | — |
| 5 | "Reportar problema" | Botón | Soporte | `onClick: () => {}` (**sin handler**) | — | — |

## 7.4 Rastreo del pedido (`TrackingSection`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | Tarjeta de mapa "Domiciliario en camino" | Display | Seguir el envío | — | — (**mock**) | — |
| 2 | Botón llamar (teléfono) | Botón | Llamar al repartidor | **Sin `onClick`** | — | — |
| 3 | Botón mensaje | Botón | Chat con el repartidor | **Sin `onClick`** | — | — |
| 4 | Timeline del pedido | Display | Estados | — | — | — |

> ⚠️ La sección de rastreo es **estática**: repartidor ("Diego Martínez"),
> sucursal, calificación, ETA y timeline son datos de ejemplo, no provienen del
> pedido real.

## 7.5 Favoritos (`FavoritesSection`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | Input "Buscar en favoritos…" | Input | Filtrar | `setFavSearch` (local) | — | — |
| 2 | Chips de categorías | Botones | Filtrar | `setFavCategory` (local) | — | — |
| 3 | "Agregar todo al carrito" | Botón | Reponer favoritos | `favorites.forEach(onAdd)` | — (carrito local) | — |
| 4 | Corazón (quitar) | Botón | Quitar favorito | `removeFromFavorites(p.id)` | `DELETE /catalog/favorites/:productId` (`catalogService.removeFavorite`) | `favorites` (delete) |
| 5 | − / + (cantidad) | Botones | Ajustar | `onRemove` / `onAdd` | — (carrito local) | — |
| 6 | "Agregar" | Botón | Añadir al carrito | `onAdd(p)` | — | — |

## 7.6 Listas de compras (`ListsSection`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | Input "Nombre de la lista…" + submit | Input/Botón | Crear lista | `createShoppingList(name)` | `POST /catalog/shopping-lists` | `shopping_lists` (insert) |
| 2 | Seleccionar lista | Botón | Abrir lista | `setSelectedListId` (local) | — | — |
| 3 | Lápiz (renombrar) + submit | Botón/Input | Renombrar | `updateShoppingList(id, name)` | `POST /catalog/shopping-lists/:id` | `shopping_lists` (update) |
| 4 | Duplicar (copiar) | Botón | Duplicar | `createShoppingList` + `addToShoppingList` | ídem (1) + (7) | `shopping_lists`, `shopping_list_items` |
| 5 | Papelera | Botón | Eliminar lista | `deleteShoppingList(id)` | `DELETE /catalog/shopping-lists/:id` | `shopping_lists` (+items) |
| 6 | − / + por ítem | Botones | Cantidad | `updateShoppingListItem` / `removeShoppingListItem` | `POST .../items/:productId` · `DELETE .../items/:productId` | `shopping_list_items` (update/delete) |
| 7 | "+ Agregar producto" + buscador | Botón/Input | Añadir ítem | `addToShoppingList(listId, productId, 1)` | `POST /catalog/shopping-lists/:id/items` | `shopping_list_items` (insert) |
| 8 | "Usar esta lista" / "Reemplazar carrito" | Botones | Pasar al carrito | `addListToCart` / `replaceListToCart` | — (carrito local) | — |

## 7.7 Direcciones (`AddressesSection`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | "Nueva dirección" | Botón | Abrir formulario | `setShowForm(true)` | — | — |
| 2 | Inputs (alias, dirección, ciudad, notas) + "Guardar" | Inputs/Botón | Crear | `saveAddr` | `POST /customer-auth/addresses` (`customerAddressService.createAddress`) | `customer_addresses` (insert; la 1ª `isDefault=true`) |
| 3 | "Cancelar" | Botón | Cerrar form | `setShowForm(false)` | — | — |
| 4 | Papelera | Botón | Eliminar | `deleteAddr(id)` | `DELETE /customer-auth/addresses/:id` | `customer_addresses` (delete; si era la predeterminada, pasa la más reciente) |
| 5 | "Establecer como predeterminada" | Botón | Predeterminar | `setDefault(id)` | `POST /customer-auth/addresses/:id/default` | `customer_addresses.isDefault` (update en todas) |
| 6 | Lápiz (editar) | Botón | Editar | **Sin `onClick`** | — | — |

## 7.8 Métodos de pago guardados (`PaymentsSection`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | "Agregar método" | Botón | Abrir form | `startAdd` | — | — |
| 2 | Radio Tarjeta / Nequi | Radio | Tipo | `setFormType` | — | — |
| 3 | Inputs de tarjeta (titular, número, MM/AA, CVV, alias) | Inputs | Datos | `setForm` | — | — |
| 4 | Input "Número de Nequi" | Input | Datos | `setForm` | — | — |
| 5 | "Guardar" (tarjeta) | Botón | Alta tarjeta | `saveMethod` | `GET /payments/wompi/config` → `POST api.wompi.co/v1/tokens/cards` → `POST /customer-auth/payment-methods` | `customer_payment_methods` (insert: `token`, `last4`, `brand`; **no** guarda el PAN) |
| 6 | "Guardar" (Nequi) | Botón | Alta Nequi | `saveMethod` | `POST /customer-auth/payment-methods` | `customer_payment_methods` (insert `methodType=NEQUI`, `phone`) |
| 7 | "Guardar" (edición) | Botón | Editar | `saveMethod` | `PUT /customer-auth/payment-methods/:id` | `customer_payment_methods` (update) |
| 8 | "Predeterminar" | Botón | Predeterminar | `setDefault(id)` | `POST /customer-auth/payment-methods/:id/default` | `customer_payment_methods.isDefault` |
| 9 | Papelera | Botón | Eliminar | `del(id)` (con `window.confirm`) | `DELETE /customer-auth/payment-methods/:id` | `customer_payment_methods` (delete) |
| 10 | "Cancelar" | Botón | Cerrar form | `setShowForm(false)` | — | — |

## 7.9 Historial de compras (`HistorySection`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | Input "Buscar productos comprados…" | Input | Filtrar | `setHistSearch` (local) | — | — |
| 2 | Select de fechas | Select | Filtrar | `setHistDate` (local) | — | — |
| 3 | "Agregar" por ítem | Botón | Reponer | `onAdd(item)` × `quantity` | — (carrito local) | — |

> El historial se **deriva** de los pedidos; no hay endpoint propio.

## 7.10 Notificaciones (`NotificationsSection`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | "Marcar todas como leídas" | Botón | Marcar todas | `setReadNotifIds` (**solo local**) | — | ⚠️ **No persiste** |
| 2 | "Preferencias" (engranaje) | Botón | Abrir panel | `setPrefOpen` | — | — |
| 3 | Toggles de preferencias (5) | Toggles | Elegir avisos | `setPrefs` (**solo local**) | — | ⚠️ **No persiste** |
| 4 | Check (marcar una leída) | Botón | Marcar leída | local + `onMarkNotifRead(id)` | `POST /notifications/:id/read` | `notifications` (update `isRead`) |
| 5 | Papelera | Botón | Eliminar | `setDeletedNotifIds` (**solo local**) | — | ⚠️ **No persiste** |

Datos: `GET /notifications` vía `useNotifications` (hook que también alimenta el
`NotificationsDropdown` del header — ver sección 09).

## 7.11 Configuración (`ProfileSection`)

| # | Control | Tipo | Propósito | Acción al activar | Endpoint / servicio | Efecto en BD |
|---|---|---|---|---|---|---|
| 1 | Inputs Nombre, Celular, Email | Inputs | Editar perfil | `setProfile` | — | — |
| 2 | Input Contraseña + ojo | Input/Botón | Cambiar clave | `setProfile` / `setShowPwd` | — | — |
| 3 | Toggle "promociones" | Toggle | Marketing | `setPrivacyPromo` | — | — |
| 4 | Toggle "datos" | Toggle | Privacidad | `setPrivacyData` | — | — |
| 5 | "Guardar cambios" | Botón | Guardar | `saveProfile` | `PUT /customer-auth/me` (`onProfileUpdated` o `customerAuthService.updateProfile`) | `customers` (update; `acceptsMarketing` → `newsletter_subscribers`) |
| 6 | "Cerrar sesión" | Botón | Confirmar salida | `setShowLogoutConfirm(true)` | — | — |
| 7 | Modal "Cerrar sesión" → "Cerrar sesión" | Botón | Salir | `handleLogout` | `POST /customer-auth/logout` | `customer_refresh_tokens` (revoca) |
| 8 | "Eliminar cuenta" | Botón | Confirmar borrado | `setShowDeleteConfirm(true)` | — | — |
| 9 | Input de confirmación (nombre) + "Eliminar" | Input/Botón | Borrar cuenta | `handleDeleteAccount` | `DELETE /customer-auth/me` | `customers` (borrado lógico) |

---

## Efectos en base de datos (resumen)

| Tabla | Cuándo | Columnas clave |
|---|---|---|
| `customers` | Registro, login social, editar perfil, eliminar cuenta | datos de perfil, `acceptsMarketing`, `deletedAt` |
| `customer_refresh_tokens` | Login, login social, logout | `token`, `expiresAt`, `revoked` |
| `newsletter_subscribers` | Registro / perfil con marketing | suscripción |
| `customer_addresses` | Direcciones CRUD | `alias`, `addressLine1`, `city`, `isDefault`, `deletedAt` |
| `customer_payment_methods` | Métodos de pago CRUD | `methodType`, `token`, `last4`, `brand`, `phone`, `isDefault`, `deletedAt` |
| `favorites` | Quitar favorito | `customerId`, `productId` |
| `shopping_lists` / `shopping_list_items` | Listas CRUD | `name`, `productId`, `quantity` |
| `notifications` | Marcar una leída | `isRead` |
| `orders` | (solo lectura) listado y detalle | — |

## Pendientes / huecos

- **Rastreo mock**: `TrackingSection` muestra datos fijos; los botones de llamar y
  mensaje no tienen handler. No refleja el estado real del pedido.
- **"Descargar factura" y "Reportar problema"**: botones sin handler.
- **Notificaciones**: marcar todas, eliminar y preferencias **no se persisten**.
- **Editar dirección**: el lápiz no tiene handler (falta el `PUT /addresses/:id`).
- **Filtrar pedidos e historial**: es local; no hay paginación.
- **Eliminar cuenta**: el texto de confirmación debe coincidir exactamente con el
  nombre/correo.
- **`customer_payment_methods` no se usa al pagar** todavía (el checkout no
  reutiliza el método guardado).
