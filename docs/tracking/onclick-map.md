# Mapa de interacciones del cliente web (`onClick` / `onSubmit`)

> Documento generado automáticamente desde el código con `node scripts-agent/tracking-onclick-map.mjs`. No editar a mano: regenerar tras cambios en la interfaz.

- **Total:** 279 interacciones (270 `onClick`, 9 `onSubmit`).
- **Archivos:** 29.

## Resumen por archivo

| Archivo | onClick | onSubmit | Total |
| --- | ---: | ---: | ---: |
| `Interface web client/src/app/components/AddressModal.tsx` | 14 | 0 | 14 |
| `Interface web client/src/app/components/AdvertisingBanner.tsx` | 5 | 0 | 5 |
| `Interface web client/src/app/components/AuthModal.tsx` | 6 | 2 | 8 |
| `Interface web client/src/app/components/BrandsSection.tsx` | 3 | 0 | 3 |
| `Interface web client/src/app/components/CartDrawer.tsx` | 10 | 0 | 10 |
| `Interface web client/src/app/components/CheckoutAddressMap.tsx` | 7 | 0 | 7 |
| `Interface web client/src/app/components/CheckoutModal.tsx` | 13 | 0 | 13 |
| `Interface web client/src/app/components/DailyDealsSection.tsx` | 9 | 0 | 9 |
| `Interface web client/src/app/components/ErrorPage.tsx` | 3 | 0 | 3 |
| `Interface web client/src/app/components/FeaturedProductsSection.tsx` | 5 | 0 | 5 |
| `Interface web client/src/app/components/Footer.tsx` | 1 | 0 | 1 |
| `Interface web client/src/app/components/Header.tsx` | 24 | 0 | 24 |
| `Interface web client/src/app/components/HeroSection.tsx` | 5 | 0 | 5 |
| `Interface web client/src/app/components/NewsletterSection.tsx` | 0 | 1 | 1 |
| `Interface web client/src/app/components/NotificationsDropdown.tsx` | 2 | 0 | 2 |
| `Interface web client/src/app/components/OrderChatConversation.tsx` | 3 | 0 | 3 |
| `Interface web client/src/app/components/OrderChatWidget.tsx` | 3 | 0 | 3 |
| `Interface web client/src/app/components/OrdersPanel.tsx` | 7 | 1 | 8 |
| `Interface web client/src/app/components/OrderTrackingModal.tsx` | 4 | 0 | 4 |
| `Interface web client/src/app/components/PopupDisplay.tsx` | 2 | 0 | 2 |
| `Interface web client/src/app/components/QuickCategoriesSection.tsx` | 10 | 0 | 10 |
| `Interface web client/src/app/components/SucursalesSection.tsx` | 3 | 0 | 3 |
| `Interface web client/src/app/ProductDetailModal.tsx` | 9 | 0 | 9 |
| `Interface web client/src/app/SocialAuthButtons.tsx` | 1 | 0 | 1 |
| `Interface web client/src/app/Views/AccountView/index.tsx` | 68 | 3 | 71 |
| `Interface web client/src/app/Views/CatalogView/index.tsx` | 31 | 1 | 32 |
| `Interface web client/src/app/Views/CatalogView/ProductCard.tsx` | 5 | 0 | 5 |
| `Interface web client/src/components/ChatbotWidget.tsx` | 16 | 1 | 17 |
| `Interface web client/src/components/ErrorBoundary.tsx` | 1 | 0 | 1 |

## Detalle

### `Interface web client/src/app/components/AddressModal.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 39 | AddressModal | `div` | Inicia sesión Debes iniciar sesión para administrar tus direcciones d… | `{onClose}` | onClick |
| 40 | AddressModal | `div` | Inicia sesión Debes iniciar sesión para administrar tus direcciones d… | `{(e) => e.stopPropagation()}` | onClick |
| 41 | AddressModal | `button` | — | `{onClose}` | onClick |
| 47 | AddressModal | `button` | Iniciar sesión | `{() => { onClose(); onLoginModal("login"); }}` | onClick |
| 101 | AddressModal | `div` | Direcciones de entrega | `{onClose}` | onClick |
| 102 | AddressModal | `div` | Direcciones de entrega | `{(e) => e.stopPropagation()}` | onClick |
| 108 | AddressModal | `button` | — | `{onClose}` | onClick |
| 118 | AddressModal | `button` | Cancelar | `{() => { setShowForm(false); setEditingId(null); }}` | onClick |
| 130 | AddressModal | `button` | — | `{handleSave}` | onClick |
| 141 | AddressModal | `button` | Agregar dirección | `{openNew}` | onClick |
| 156 | AddressModal | `button` | — | `{() => openEdit(addr)}` | onClick |
| 157 | AddressModal | `button` | — | `{() => handleDelete(addr.id)}` | onClick |
| 164 | AddressModal | `button` | Establecer como predeterminada | `{() => handleSetDefault(addr.id)}` | onClick |
| 168 | AddressModal | `button` | Agregar nueva dirección | `{openNew}` | onClick |
### `Interface web client/src/app/components/AdvertisingBanner.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 172 | AdvertisingBanner | `div` | — | `{bannerClickable ? handleClick : undefined}` | onClick |
| 266 | AdvertisingBanner | `button` | — | `{(e) => { e.stopPropagation(); handleClick(); }}` | onClick |
| 288 | AdvertisingBanner | `button` | — | `{(e) => { e.stopPropagation(); go(-1); }}` | onClick |
| 298 | AdvertisingBanner | `button` | — | `{(e) => { e.stopPropagation(); go(1); }}` | onClick |
| 316 | AdvertisingBanner | `button` | — | `{(e) => { e.stopPropagation(); goTo(i, i > current ? 1 : -1); setTimeout(() => startTimer(), SLIDE_OUT_MS + 60); }}` | onClick |
### `Interface web client/src/app/components/AuthModal.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 49 | AuthModal | `div` | © 2026 Desarrollado por | `{onClose}` | onClick |
| 55 | AuthModal | `button` | — | `{onClose}` | onClick |
| 107 | AuthModal | `button` | Iniciar sesión | `{() => onSetModalView("login")}` | onClick |
| 114 | AuthModal | `button` | Crear cuenta gratis | `{() => onSetModalView("register")}` | onClick |
| 134 | AuthModal | `form` | Correo electrónico Contraseña ¿Olvidaste tu contraseña? ¿No tienes cu… | `{onLoginSubmit}` | onSubmit |
| 213 | AuthModal | `button` | Regístrate gratis | `{() => onSetModalView("register")}` | onClick |
| 224 | AuthModal | `form` | Nombre Apellido Correo electrónico Celular Contraseña ¿Ya tienes cuen… | `{onRegisterSubmit}` | onSubmit |
| 363 | AuthModal | `button` | Inicia sesión | `{() => onSetModalView("login")}` | onClick |
### `Interface web client/src/app/components/BrandsSection.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 57 | BrandsSection | `button` | — | `{() => scrollBy(-1)}` | onClick |
| 60 | BrandsSection | `button` | — | `{() => scrollBy(1)}` | onClick |
| 80 | BrandsSection | `button` | — | `{() => onBrandClick?.(brand.id)}` | onClick |
### `Interface web client/src/app/components/CartDrawer.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 113 | RelatedCarousel | `button` | + | `{() => onAdd(p, 1)}` | onClick |
| 121 | RelatedCarousel | `button` | Intercambiar por este producto | `{() => onSwap(p, productId, quantity)}` | onClick |
| 219 | CartDrawer | `div` | Mi Carrito | `{onClose}` | onClick |
| 244 | CartDrawer | `button` | — | `{onClose}` | onClick |
| 267 | CartDrawer | `button` | Seguir comprando | `{onClose}` | onClick |
| 320 | CartDrawer | `button` | — | `{() => onRemove(item.id)}` | onClick |
| 329 | CartDrawer | `button` | — | `{() => onAdd(item)}` | onClick |
| 335 | CartDrawer | `button` | — | `{() => onDelete(item.id)}` | onClick |
| 364 | CartDrawer | `button` | Finalizar pedido → | `{onCheckout}` | onClick |
| 371 | CartDrawer | `button` | Seguir comprando | `{onClose}` | onClick |
### `Interface web client/src/app/components/CheckoutAddressMap.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 471 | CheckoutAddressMap | `button` | Usar mi ubicación actual | `{useMyLocation}` | onClick |
| 493 | CheckoutAddressMap | `button` | — | `{validateWithPhone}` | onClick |
| 532 | CheckoutAddressMap | `button` | Usar esta dirección | `{applySuggestion}` | onClick |
| 559 | CheckoutAddressMap | `button` | — | `{useMyLocation}` | onClick |
| 570 | CheckoutAddressMap | `button` | — | `{validateWithPhone}` | onClick |
| 581 | CheckoutAddressMap | `button` | Continuar de todas formas | `{() => setDistanceDismissed(true)}` | onClick |
| 593 | CheckoutAddressMap | `button` | — | `{() => onConfirmedChange(!confirmed)}` | onClick |
### `Interface web client/src/app/components/CheckoutModal.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 330 | CheckoutModal | `button` | — | `{() => checkoutStep === 1 ? onClose() : onSetCheckoutStep(checkoutStep - 1) }` | onClick |
| 345 | CheckoutModal | `button` | — | `{onClose}` | onClick |
| 484 | CheckoutModal | `button` | Continuar con la dirección → | `{() => onSetCheckoutStep(2)}` | onClick |
| 511 | CheckoutModal | `button` | — | `{() => selectSavedAddress(a.id)}` | onClick |
| 555 | CheckoutModal | `button` | + Usar otra dirección | `{switchToNewAddress}` | onClick |
| 764 | CheckoutModal | `button` | ← Volver a mis direcciones | `{() => { setUsingNewAddress(false); if (selectedAddressId !== null) { selectSavedAddress(selectedAddressId); } else if (savedAddresses.leng…` | onClick |
| 819 | CheckoutModal | `button` | Continuar con el pago → | `{() => onSetCheckoutStep(3)}` | onClick |
| 1078 | CheckoutModal | `button` | — | `{() => onSetPsePayment((prev) => ({ ...prev, personType: type, })) }` | onClick |
| 1136 | CheckoutModal | `button` | — | `{handleCopyLlave}` | onClick |
| 1199 | CheckoutModal | `button` | — | `{onPlaceOrder}` | onClick |
| 1269 | CheckoutModal | `button` | — | `{handleCopyLlave}` | onClick |
| 1347 | CheckoutModal | `button` | Ver mis pedidos | `{onViewOrders}` | onClick |
| 1354 | CheckoutModal | `button` | Seguir comprando | `{onClose}` | onClick |
### `Interface web client/src/app/components/DailyDealsSection.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 208 | DailyDealsSection | `button` | — | `{() => setFeaturedIdx(i)}` | onClick |
| 221 | DailyDealsSection | `div` | ⏱ | `{featuredClickable ? () => onApplyFilter!(featuredFilter!) : undefined}` | onClick |
| 268 | DailyDealsSection | `button` | — | `{(e) => { e.stopPropagation(); setFeaturedIdx(i); }}` | onClick |
| 288 | DailyDealsSection | `button` | — | `{() => scrollCarousel(-1)}` | onClick |
| 295 | DailyDealsSection | `button` | — | `{() => scrollCarousel(1)}` | onClick |
| 323 | DailyDealsSection | `button` | % OFF | `{() => onProductClick(p)}` | onClick |
| 344 | DailyDealsSection | `button` | — | `{() => decQty(p.id)}` | onClick |
| 349 | DailyDealsSection | `button` | — | `{() => incQty(p.id)}` | onClick |
| 355 | DailyDealsSection | `button` | Agregar | `{() => handleAdd(p)}` | onClick |
### `Interface web client/src/app/components/ErrorPage.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 117 | ErrorPage | `button` | Volver | `{() => window.history.back()}` | onClick |
| 130 | ErrorPage | `button` | Reintentar | `{onRetry}` | onClick |
| 144 | ErrorPage | `button` | Ir al inicio | `{onGoHome}` | onClick |
### `Interface web client/src/app/components/FeaturedProductsSection.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 82 | FeaturedProductsSection | `button` | Ver catálogo completo | `{() => onViewAll()}` | onClick |
| 113 | FeaturedProductsSection | `button` | — | `{() => onTabChange(tab.slug)}` | onClick |
| 130 | FeaturedProductsSection | `button` | Desplazar filtros a la izquierda | `{() => scrollTabs(-1)}` | onClick |
| 141 | FeaturedProductsSection | `button` | Desplazar filtros a la derecha | `{() => scrollTabs(1)}` | onClick |
| 176 | FeaturedProductsSection | `button` | Ver todos los productos | `{() => onViewAll()}` | onClick |
### `Interface web client/src/app/components/Footer.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 137 | Footer | `button` | — | `{() => onCategoryClick(c.name)}` | onClick |
### `Interface web client/src/app/components/Header.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 51 | ThemeToggle | `button` | — | `{onToggle}` | onClick |
| 368 | FlyoutColumn | `button` | — | `{() => { onOpenCatalog(id); setCategoriesOpen(false); }}` | onClick |
| 418 | Header | `a` | — | `{(e) => { e.preventDefault(); onHome(); }}` | onClick |
| 443 | Header | `button` | Abrir menú | `{() => { if (!mobileMenuOpen) setMobileMenuSeen(true); setMobileMenuOpen(!mobileMenuOpen); }}` | onClick |
| 474 | Header | `a` | — | `{(e) => { e.preventDefault(); onHome(); }}` | onClick |
| 495 | Header | `button` | Buscar | `{handleSearch}` | onClick |
| 526 | Header | `button` | — | `{() => { setSearchQuery(""); setSearchOpen(false); }}` | onClick |
| 556 | Header | `button` | — | `{() => { setSearchQuery(q); }}` | onClick |
| 585 | Header | `button` | — | `{() => { setSearchQuery(cat.name); }}` | onClick |
| 674 | Header | `button` | — | `{() => onRemoveFromCart(p.id)}` | onClick |
| 684 | Header | `button` | — | `{() => onAddToCart(p)}` | onClick |
| 691 | Header | `button` | Agregar | `{() => onAddToCart(p)}` | onClick |
| 709 | Header | `button` | Ver todos los resultados para " " | `{() => { setSearchOpen(false); onCatalogSearch(searchQuery); }}` | onClick |
| 730 | Header | `button` | — | `{() => setSearchQuery(q)}` | onClick |
| 748 | Header | `button` | — | `{() => { if (customer) { if (onAccount) { onAccount(); return; } onOrdersOpen(); return; } onLoginModal("login"); }}` | onClick |
| 771 | Header | `button` | — | `{() => setNotifOpen(!notifOpen)}` | onClick |
| 799 | Header | `button` | Pedidos | `{onOrdersOpen}` | onClick |
| 814 | Header | `button` | Carrito | `{onCartOpen}` | onClick |
| 833 | Header | `button` | — | `{() => { if (customer) { if (onAccount) { onAccount(); return; } onOrdersOpen(); return; } onLoginModal("login"); }}` | onClick |
| 863 | Header | `a` | — | `{(e) => { e.preventDefault(); if (item === "Inicio") onHome(); if (item === "Catálogo") onOpenCatalog(); if (item === "Catalogo") onOpenCat…` | onClick |
| 908 | Header | `button` | — | `{toggleTheme}` | onClick |
| 954 | Header | `button` | Nuestros productos | `{() => setCategoriesOpen(!categoriesOpen)}` | onClick |
| 1024 | Header | `button` | — | `{() => { if (item === "Inicio") onHome(); if (item === "Catálogo") onOpenCatalog(); if (item === "Mi cuenta" && onAccount) onAccount(); }}` | onClick |
| 1036 | Header | `button` | Entregar en | `{() => setAddressModalOpen(true)}` | onClick |
### `Interface web client/src/app/components/HeroSection.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 183 | HeroSection | `div` | — | `{bannerClickable ? handleBannerClick : undefined}` | onClick |
| 261 | HeroSection | `button` | — | `{(e) => { e.stopPropagation(); if (slide.filter && onApplyFilter) onApplyFilter(slide.filter); }}` | onClick |
| 308 | HeroSection | `button` | — | `{(e) => { e.stopPropagation(); goSlide(-1); }}` | onClick |
| 318 | HeroSection | `button` | — | `{(e) => { e.stopPropagation(); goSlide(1); }}` | onClick |
| 338 | HeroSection | `button` | — | `{() => { goTo(i); startTimer(); }}` | onClick |
### `Interface web client/src/app/components/NewsletterSection.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 81 | NewsletterSection | `form` | Acepto los términos y condiciones del newsletter y autorizo el envío … | `{handleSubmit}` | onSubmit |
### `Interface web client/src/app/components/NotificationsDropdown.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 54 | NotificationsDropdown | `button` | — | `{onClose}` | onClick |
| 82 | NotificationsDropdown | `button` | — | `{handleClick}` | onClick |
### `Interface web client/src/app/components/OrderChatConversation.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 136 | OrderChatConversation | `button` | Volver | `{onBack}` | onClick |
| 153 | OrderChatConversation | `button` | Cerrar | `{onClose}` | onClick |
| 249 | OrderChatConversation | `button` | Enviar mensaje | `{() => void send()}` | onClick |
### `Interface web client/src/app/components/OrderChatWidget.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 146 | OrderChatWidget | `button` | — | `{() => setOpen((v) => !v)}` | onClick |
| 217 | OrderChatWidget | `button` | Cerrar | `{() => setOpen(false)}` | onClick |
| 238 | OrderChatWidget | `button` | 🛵 Pedido | `{() => openConversation(o.id)}` | onClick |
### `Interface web client/src/app/components/OrdersPanel.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 76 | OrdersPanel | `div` | — | `{() => { onClose(); onSelectOrder(null); }}` | onClick |
| 85 | OrdersPanel | `button` | — | `{() => onSelectOrder(null)}` | onClick |
| 105 | OrdersPanel | `button` | — | `{() => { onClose(); onSelectOrder(null); }}` | onClick |
| 123 | OrdersPanel | `form` | — | `{(e) => { e.preventDefault(); void handleTrack(); }}` | onSubmit |
| 160 | OrdersPanel | `button` | Ir a comprar | `{() => onGoToCatalog()}` | onClick |
| 191 | OrdersPanel | `button` | producto · | `{() => onSelectOrder(order)}` | onClick |
| 217 | OrdersPanel | `span` | 🛵 Rastrear en el mapa | `{(e) => { e.stopPropagation(); onTrackOrder(String(order.id)); }}` | onClick |
| 320 | OrdersPanel | `button` | 🛵 Ver rastreo en el mapa | `{() => onTrackOrder(String(selectedOrder.id))}` | onClick |
### `Interface web client/src/app/components/OrderTrackingModal.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 143 | OrderTrackingModal | `div` | Rastreo en vivo Pedido Cerrar | `{onClose}` | onClick |
| 159 | OrderTrackingModal | `button` | Cerrar | `{onClose}` | onClick |
| 185 | OrderTrackingModal | `button` | Reintentar | `{() => void load()}` | onClick |
| 274 | OrderTrackingModal | `button` | Chatear | `{() => setChatOpen(true)}` | onClick |
### `Interface web client/src/app/components/PopupDisplay.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 226 | PopupDisplay | `div` | — | `{() => handleClick(p)}` | onClick |
| 266 | PopupDisplay | `button` | Cerrar | `{(e) => handleDismiss(p.id, e)}` | onClick |
### `Interface web client/src/app/components/QuickCategoriesSection.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 35 | ProductTypeButton | `button` | productos | `{onClick}` | onClick |
| 184 | QuickCategoriesSection | `button` | Ver todos | `{() => setExpanded(true)}` | onClick |
| 201 | QuickCategoriesSection | `button` | Anterior | `{() => step(-1)}` | onClick |
| 220 | QuickCategoriesSection | `ProductTypeButton` | ProductTypeButton | `{() => onProductTypeClick(pt.code)}` | onClick |
| 226 | QuickCategoriesSection | `button` | Siguiente | `{() => step(1)}` | onClick |
| 243 | QuickCategoriesSection | `ProductTypeButton` | ProductTypeButton | `{() => onProductTypeClick(pt.code)}` | onClick |
| 254 | QuickCategoriesSection | `div` | Todos los tipos de producto | `{() => { setExpanded(false); setSearchQuery(""); }}` | onClick |
| 257 | QuickCategoriesSection | `div` | Todos los tipos de producto | `{(e) => e.stopPropagation()}` | onClick |
| 262 | QuickCategoriesSection | `button` | — | `{() => { setExpanded(false); setSearchQuery(""); }}` | onClick |
| 287 | QuickCategoriesSection | `ProductTypeButton` | ProductTypeButton | `{() => { onProductTypeClick(pt.code); setExpanded(false); setSearchQuery(""); }}` | onClick |
### `Interface web client/src/app/components/SucursalesSection.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 82 | SucursalesSection | `button` | Ver todas en el mapa | `{() => openMap("Sucursales Mercaldas Manizales, Colombia")}` | onClick |
| 96 | SucursalesSection | `div` | Cómo llegar | `{() => openMap(branchAddress(s))}` | onClick |
| 143 | SucursalesSection | `button` | Cómo llegar | `{(e) => { e.stopPropagation(); openMap(branchAddress(s)); }}` | onClick |
### `Interface web client/src/app/ProductDetailModal.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 172 | ProductDetailModal | `div` | Cerrar Descripción Especificaciones | `{onClose}` | onClick |
| 180 | ProductDetailModal | `div` | Cerrar Descripción Especificaciones | `{(e) => e.stopPropagation()}` | onClick |
| 187 | ProductDetailModal | `button` | Cerrar | `{onClose}` | onClick |
| 273 | ProductDetailModal | `button` | — | `{() => setLocalQty((prev) => Math.max(1, prev - 1))}` | onClick |
| 283 | ProductDetailModal | `button` | — | `{() => setLocalQty((prev) => prev + 1)}` | onClick |
| 290 | ProductDetailModal | `button` | — | `{() => onAdd(product, localQty)}` | onClick |
| 402 | RelatedProductCard | `button` | — | `{() => setLocalQty((prev) => Math.max(1, prev - 1))}` | onClick |
| 410 | RelatedProductCard | `button` | — | `{() => setLocalQty((prev) => prev + 1)}` | onClick |
| 417 | RelatedProductCard | `button` | Agregar | `{() => onAdd(rp, localQty)}` | onClick |
### `Interface web client/src/app/SocialAuthButtons.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 45 | SocialAuthButtons | `button` | con Google | `{() => { setIsSubmitting(true); startGoogleLogin(); }}` | onClick |
### `Interface web client/src/app/Views/AccountView/index.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 862 | StarRating | `button` | — | `{() => onChange?.(n)}` | onClick |
| 993 | EmptyState | `button` | — | `{onCta}` | onClick |
| 1418 | Sidebar | `button` | — | `{() => navigate(item.id)}` | onClick |
| 1450 | Sidebar | `button` | Volver a la tienda | `{onBack}` | onClick |
| 1520 | OrdersSection | `button` | — | `{() => setFilter(f.id)}` | onClick |
| 1614 | OrdersSection | `button` | Ver detalle | `{() => { setSelectedOrderId(order.id); navigate("order-detail"); }}` | onClick |
| 1624 | OrdersSection | `button` | Rastrear pedido | `{() => { setTrackingOrderId(order.id); if (onOpenTracking) { onOpenTracking(order.id); } else { navigate("tracking"); } }}` | onClick |
| 1641 | OrdersSection | `button` | Comprar de nuevo | `{() => order.items.forEach((i) => onAdd(i as unknown as Product), ) }` | onClick |
| 1705 | OrderDetailSection | `button` | Mis pedidos | `{() => navigate("orders")}` | onClick |
| 1896 | OrderDetailSection | `button` | Ver mapa en vivo | `{() => onOpenTracking?.(order.id)}` | onClick |
| 1915 | OrderDetailSection | `button` | — | `{a.onClick}` | onClick |
| 1948 | TrackingSection | `button` | Mis pedidos | `{() => navigate("orders")}` | onClick |
| 2139 | FavoritesSection | `button` | Agregar todo al carrito | `{() => favorites.forEach((p) => onAdd(p))}` | onClick |
| 2184 | FavoritesSection | `button` | — | `{() => setFavCategory(c)}` | onClick |
| 2214 | FavoritesSection | `button` | — | `{() => removeFromFavorites(p.id)}` | onClick |
| 2259 | FavoritesSection | `button` | — | `{() => onRemove(p.id)}` | onClick |
| 2269 | FavoritesSection | `button` | — | `{() => onAdd(p)}` | onClick |
| 2276 | FavoritesSection | `button` | — | `{() => onAdd(p)}` | onClick |
| 2490 | ListsSection | `form` | Crear | `{(e) => { e.preventDefault(); createList(); }}` | onSubmit |
| 2525 | ListsSection | `div` | — | `{() => setSelectedListId(list.id)}` | onClick |
| 2529 | ListsSection | `form` | ✓ | `{(e) => { e.preventDefault(); renameList(list.id, editName); }}` | onSubmit |
| 2565 | ListsSection | `form` | + | `{(e) => { e.preventDefault(); createList(); }}` | onSubmit |
| 2603 | ListsSection | `button` | — | `{() => { setEditingId(selectedList.id); setEditName(selectedList.name); }}` | onClick |
| 2612 | ListsSection | `button` | — | `{() => duplicateList(selectedList)}` | onClick |
| 2618 | ListsSection | `button` | — | `{() => deleteList(selectedList.id)}` | onClick |
| 2663 | ListsSection | `button` | — | `{() => updateQty( selectedList.id, productId, quantity - 1, ) }` | onClick |
| 2678 | ListsSection | `button` | — | `{() => updateQty( selectedList.id, productId, quantity + 1, ) }` | onClick |
| 2691 | ListsSection | `button` | — | `{() => removeItem(selectedList.id, productId) }` | onClick |
| 2707 | ListsSection | `button` | Agregar producto | `{() => setShowAddProduct(!showAddProduct)}` | onClick |
| 2717 | ListsSection | `button` | Agregar al carrito | `{() => addListToCart(selectedList)}` | onClick |
| 2726 | ListsSection | `button` | Reemplazar carrito | `{() => replaceListToCart(selectedList)}` | onClick |
| 2767 | ListsSection | `button` | — | `{() => { addToList(product); setProductSearch(""); }}` | onClick |
| 2891 | AddressesSection | `button` | Nueva dirección | `{() => setShowForm(true)}` | onClick |
| 2937 | AddressesSection | `button` | — | `{() => deleteAddr(addr.id)}` | onClick |
| 2960 | AddressesSection | `button` | Establecer como predeterminada | `{() => setDefault(addr.id)}` | onClick |
| 3005 | AddressesSection | `button` | — | `{saveAddr}` | onClick |
| 3013 | AddressesSection | `button` | Cancelar | `{() => { setShowForm(false); setForm({}); }}` | onClick |
| 3217 | PaymentsSection | `button` | Agregar método | `{startAdd}` | onClick |
| 3283 | PaymentsSection | `button` | Predeterminar | `{() => setDefault(pm.id)}` | onClick |
| 3290 | PaymentsSection | `button` | — | `{() => startEdit(pm)}` | onClick |
| 3296 | PaymentsSection | `button` | — | `{() => del(pm.id)}` | onClick |
| 3465 | PaymentsSection | `button` | — | `{saveMethod}` | onClick |
| 3473 | PaymentsSection | `button` | Cancelar | `{() => { setShowForm(false); setEditingId(null); setForm({}); }}` | onClick |
| 3676 | HistorySection | `button` | Comprar de nuevo | `{() => { for (let i = 0; i < item.quantity; i++) onAdd(item as unknown as Product); }}` | onClick |
| 3742 | NotificationsSection | `button` | Marcar todas como leídas | `{() => setReadNotifIds( new Set(notifications.map((n) => String(n.id))), ) }` | onClick |
| 3753 | NotificationsSection | `button` | Preferencias | `{() => setPrefOpen((v) => !v)}` | onClick |
| 3787 | NotificationsSection | `div` | — | `{() => setPrefs((p) => ({ ...p, [key]: !p[key as keyof typeof prefs], })) }` | onClick |
| 3854 | NotificationsSection | `button` | — | `{() => { setReadNotifIds((prev) => new Set(prev).add(n.id)); onMarkNotifRead?.(Number(n.id)); }}` | onClick |
| 3864 | NotificationsSection | `button` | — | `{() => setDeletedNotifIds((prev) => new Set(prev).add(n.id)) }` | onClick |
| 4002 | ProfileSection | `button` | Cerrar | `{() => setError("")}` | onClick |
| 4105 | ProfileSection | `button` | — | `{() => setShowPwd((v) => !v)}` | onClick |
| 4156 | ProfileSection | `div` | — | `{() => set((v: boolean) => !v)}` | onClick |
| 4170 | ProfileSection | `button` | — | `{saveProfile}` | onClick |
| 4196 | ProfileSection | `button` | Cerrar sesión | `{() => setShowLogoutConfirm(true)}` | onClick |
| 4202 | ProfileSection | `button` | Eliminar cuenta | `{() => { setDeleteConfirmInput(""); setShowDeleteConfirm(true); }}` | onClick |
| 4217 | ProfileSection | `div` | Cerrar sesión ¿Estás seguro de que deseas cerrar sesión? Cancelar Cer… | `{() => setShowLogoutConfirm(false)}` | onClick |
| 4220 | ProfileSection | `div` | Cerrar sesión ¿Estás seguro de que deseas cerrar sesión? Cancelar Cer… | `{(e) => e.stopPropagation()}` | onClick |
| 4228 | ProfileSection | `button` | Cancelar | `{() => setShowLogoutConfirm(false)}` | onClick |
| 4234 | ProfileSection | `button` | Cerrar sesión | `{handleLogout}` | onClick |
| 4246 | ProfileSection | `div` | Eliminar cuenta Esta acción es irreversible. Todos tus datos serán el… | `{() => setShowDeleteConfirm(false)}` | onClick |
| 4249 | ProfileSection | `div` | Eliminar cuenta Esta acción es irreversible. Todos tus datos serán el… | `{(e) => e.stopPropagation()}` | onClick |
| 4277 | ProfileSection | `button` | Cancelar | `{() => setShowDeleteConfirm(false)}` | onClick |
| 4283 | ProfileSection | `button` | — | `{handleDeleteAccount}` | onClick |
| 4300 | ProfileSection | `div` | Cambios guardados Tu información se actualizó correctamente. Entendido | `{() => setShowSavedModal(false)}` | onClick |
| 4304 | ProfileSection | `div` | Cambios guardados Tu información se actualizó correctamente. Entendido | `{(e) => e.stopPropagation()}` | onClick |
| 4316 | ProfileSection | `button` | Entendido | `{() => setShowSavedModal(false)}` | onClick |
| 4367 | UserAdminView | `button` | — | `{onBack}` | onClick |
| 4380 | UserAdminView | `button` | Menú | `{() => setMobileNavOpen((v) => !v)}` | onClick |
| 4394 | UserAdminView | `div` | Mi Cuenta C | `{() => setMobileNavOpen(false)}` | onClick |
| 4399 | UserAdminView | `button` | — | `{() => setMobileNavOpen(false)}` | onClick |
| 4430 | UserAdminView | `button` | — | `{() => navigate(item.id)}` | onClick |
### `Interface web client/src/app/Views/CatalogView/index.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 416 | renderFlyoutNode | `div` | — | `{() => toggleCategory(node.id)}` | onClick |
| 436 | renderFlyoutNode | `span` | — | `{() => toggleCategory(node.id)}` | onClick |
| 490 | SidebarContent | `div` | — | `{() => toggleCategory(cat.id)}` | onClick |
| 516 | SidebarContent | `span` | — | `{() => toggleCategory(cat.id)}` | onClick |
| 522 | SidebarContent | `button` | — | `{(e) => { e.stopPropagation(); captureAnchor(e.currentTarget); setPinCat(isOpen ? null : cat.id); }}` | onClick |
| 586 | SidebarContent | `div` | — | `{() => setCatalogPriceRange(r.id)}` | onClick |
| 601 | SidebarContent | `span` | — | `{() => setCatalogPriceRange(r.id)}` | onClick |
| 644 | SidebarContent | `div` | — | `{() => setCatalogBrand(checked ? null : brand.id)}` | onClick |
| 668 | SidebarContent | `span` | — | `{() => setCatalogBrand(checked ? null : brand.id)}` | onClick |
| 699 | SidebarContent | `div` | — | `{() => setCatalogProductType(checked ? "" : pt.code) }` | onClick |
| 736 | SidebarContent | `span` | — | `{() => setCatalogProductType(checked ? "" : pt.code) }` | onClick |
| 764 | SidebarContent | `div` | — | `{() => setCatalogOnSale(!catalogOnSale)}` | onClick |
| 776 | SidebarContent | `button` | Limpiar todos los filtros | `{clearAll}` | onClick |
| 803 | CatalogPage | `form` | — | `{(e) => { e.preventDefault(); }}` | onSubmit |
| 838 | CatalogPage | `button` | Filtros | `{() => setMobileFiltersOpen(true)}` | onClick |
| 879 | CatalogPage | `button` | — | `{() => toggleCategory(cat)}` | onClick |
| 893 | CatalogPage | `button` | — | `{() => setCatalogOnSale(false)}` | onClick |
| 907 | CatalogPage | `button` | — | `{() => setCatalogPriceRange("all")}` | onClick |
| 919 | CatalogPage | `button` | — | `{() => setCatalogBrand(null)}` | onClick |
| 931 | CatalogPage | `button` | — | `{() => setCatalogProductType("")}` | onClick |
| 943 | CatalogPage | `button` | — | `{() => setCatalogBranch(null)}` | onClick |
| 954 | CatalogPage | `button` | — | `{() => setCatalogSearch("")}` | onClick |
| 965 | CatalogPage | `button` | — | `{() => setCatalogProductIds([])}` | onClick |
| 973 | CatalogPage | `button` | Limpiar todo | `{clearAll}` | onClick |
| 986 | CatalogPage | `button` | Ordenar por | `{() => setSortOpen((v) => !v)}` | onClick |
| 1029 | CatalogPage | `button` | — | `{() => { setCatalogSort(o.id); setSortOpen(false); }}` | onClick |
| 1071 | CatalogPage | `button` | Todas las sucursales | `{() => setCatalogBranch(null)}` | onClick |
| 1092 | CatalogPage | `button` | — | `{() => setCatalogBranch(catalogBranch === b.id ? null : b.id) }` | onClick |
| 1165 | CatalogPage | `button` | Limpiar filtros | `{clearAll}` | onClick |
| 1188 | CatalogPage | `div` | Filtros Aplicar filtros | `{() => setMobileFiltersOpen(false)}` | onClick |
| 1198 | CatalogPage | `button` | — | `{() => setMobileFiltersOpen(false)}` | onClick |
| 1209 | CatalogPage | `button` | Aplicar filtros | `{() => setMobileFiltersOpen(false)}` | onClick |
### `Interface web client/src/app/Views/CatalogView/ProductCard.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 31 | ProductCard | `button` | — | `{() => onProductClick(product)}` | onClick |
| 52 | ProductCard | `button` | — | `{() => onProductClick(product)}` | onClick |
| 74 | ProductCard | `button` | — | `{(e) => { e.stopPropagation(); setLocalQty((prev) => Math.max(1, prev - 1)); }}` | onClick |
| 87 | ProductCard | `button` | — | `{(e) => { e.stopPropagation(); setLocalQty((prev) => prev + 1); }}` | onClick |
| 98 | ProductCard | `button` | — | `{(e) => { e.stopPropagation(); onAdd(product, localQty); }}` | onClick |
### `Interface web client/src/components/ChatbotWidget.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 368 | ChatbotWidget | `button` | Cerrar aviso | `{() => setShowHint(false)}` | onClick |
| 389 | ChatbotWidget | `button` | Daisy | `{() => (open ? setOpen(false) : openWidget())}` | onClick |
| 458 | ChatbotWidget | `button` | Ver carrito de compras | `{openCurrentCart}` | onClick |
| 483 | ChatbotWidget | `button` | Cerrar | `{() => setOpen(false)}` | onClick |
| 563 | ChatbotWidget | `button` | 🛒 Ver mi carrito ( ) | `{() => openCartModal(m.payload!)}` | onClick |
| 590 | ChatbotWidget | `button` | — | `{() => send(o.message)}` | onClick |
| 602 | ChatbotWidget | `form` | Enviar | `{(e) => { e.preventDefault(); void send(input); }}` | onSubmit |
| 711 | BotCartModal | `div` | Tu carrito de compras 🛒 Revisa tu lista y elige productos para agreg… | `{onClose}` | onClick |
| 715 | BotCartModal | `div` | Tu carrito de compras 🛒 Revisa tu lista y elige productos para agreg… | `{(e) => e.stopPropagation()}` | onClick |
| 726 | BotCartModal | `button` | Cerrar | `{onClose}` | onClick |
| 769 | BotCartModal | `button` | Quitar uno | `{() => onDec(it)}` | onClick |
| 778 | BotCartModal | `button` | Agregar uno | `{() => onInc(it)}` | onClick |
| 786 | BotCartModal | `button` | Eliminar | `{() => onRemove(it)}` | onClick |
| 823 | BotCartModal | `button` | — | `{() => void runSearch()}` | onClick |
| 850 | BotCartModal | `button` | + Agregar | `{() => onAddProduct(p, 1)}` | onClick |
| 875 | BotCartModal | `button` | — | `{() => cart && onApplyCart(cart)}` | onClick |
| 882 | BotCartModal | `button` | Seguir comprando | `{onClose}` | onClick |
### `Interface web client/src/components/ErrorBoundary.tsx`

| Línea | Componente | Elemento | Etiqueta / aria-label | Handler | Evento |
| ---: | --- | --- | --- | --- | --- |
| 69 | render | `button` | Recargar | `{() => window.location.reload()}` | onClick |
