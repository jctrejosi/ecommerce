# MercAldas — App móvil del cliente (React Native + Expo)

Réplica de la versión móvil del web client como app instalable (APK),
reutilizando el mismo backend NestJS y los mismos endpoints del web.

## Stack

- Expo SDK 57 + expo-router (tabs: Inicio · Catálogo · Carrito · Cuenta)
- TanStack Query, Zustand, expo-secure-store (sesión con refresh token)

## Configuración

Crea `.env` en la raíz del proyecto (se inyecta como `EXPO_PUBLIC_*`):

```
EXPO_PUBLIC_API_URL=https://tu-backend.com
```

- `EXPO_PUBLIC_API_URL`: base del backend (`/catalog`, `/orders`,
  `/customer-auth`, `/banners`…). En emulador Android, para apuntar a tu
  máquina usa `http://10.0.2.2:3000`.

## Desarrollo

```bash
pnpm install
pnpm start            # Expo dev server (QR para Expo Go)
pnpm android          # build nativo + emulador (expo run:android)
pnpm typecheck        # verificación de tipos
```

## Generar el APK

**APK ya generado** (build local):
`android/app/build/outputs/apk/release/app-release.apk`

Para recompilar localmente (Android SDK + JDK 17-21):

```bash
pnpm prebuild            # genera la carpeta android/ (si no existe)
cd android
./gradlew assembleRelease
# APK: app/build/outputs/apk/release/app-release.apk
```

Nota: en esta máquina no hay JDK (solo JRE), por eso se descargó un JDK
Temurin 21 portátil en `.jdk/` y se apuntó en `android/gradle.properties`
(`org.gradle.java.home`). Si instalas un JDK normal, puedes quitar esa línea.

Opciones:

1. **EAS (cloud):**

   ```bash
   pnpm add -D eas-cli
   npx eas build -p android --profile preview
   ```

2. **Local (Android SDK + JDK instalados):**

   ```bash
   pnpm prebuild            # genera la carpeta android/
   cd android
   ./gradlew assembleRelease
   # APK: android/app/build/outputs/apk/release/app-release.apk
   ```

## Estado actual (v0.1)

Implementado:

- Inicio: header con búsqueda, banners hero, "Nuestros productos" (tipos con
  emoji) y grilla de productos destacados.
- Catálogo: búsqueda con debounce, filtro por tipo de producto, paginación.
- Detalle de producto: precio/descuento, descripción, cantidad y relacionados.
- Carrito local (Zustand) con cantidades y subtotal.
- Checkout (invitado o autenticado): dirección, tipo de envío, método de pago,
  confirmación con código de pedido.
- Cuenta: login/registro, perfil, lista de pedidos y logout.

Pendiente (siguientes iteraciones):

- Rastreo en vivo del pedido con mapa (replicar OrderTrackingModal; requiere
  maplibre-react-native).
- Favoritos, direcciones y métodos de pago guardados.
- Chatbot de compras (bot API), popups, banners de promociones y notificaciones.
- Pago con tarjeta (epayco/wompi) en el checkout.
