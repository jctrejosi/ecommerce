# Delivery App — Repartidores (React Native · Expo)

App móvil de repartidores para el ecommerce. Raíz del proyecto: aquí vive la
app (Expo SDK 57 · React Native 0.86) y en [`docs/`](docs/) está el diseño
completo (arquitectura, modelo de datos y máquina de estados).

## Estructura

```text
Interface movil delivery/
├── app/                    # rutas (Expo Router)
├── src/                    # api · auth · delivery · maps · tracking · notifications · ui
├── docs/                   # diseño: arquitectura · modelo-de-datos · maquina-de-estados
├── android/                # proyecto nativo generado (dev build)
├── app.json / package.json / tsconfig.json
└── README.md
```

## Requisitos (esta máquina ya los tiene)

- Node 20+ y pnpm · Expo SDK 57
- Android SDK en `~/Android/Sdk` + JDK 21 en `~/.local/java/temurin21`
  (variables en `~/.bashrc`) · AVD `delivery` (Pixel 6 · Android 36) · KVM

## Correr

```bash
pnpm install
pnpm typecheck      # tsc --noEmit
```

### En el emulador Android (vía fiel: mapa real + GPS)

```bash
# 1) Emulador (abre una ventana; queda en segundo plano)
emulator -avd delivery -no-snapshot -no-audio -no-boot-anim &

# 2) Metro (dev server del JS)
npx expo start

# 3) Si el APK no está instalado aún (o tras cambios nativos):
cd android && ./gradlew assembleDebug && cd ..
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.dsi.deliveryapp/.MainActivity
```

- Detener: `adb emu kill` (emulador) y Ctrl+C (Metro).
- Cambios solo JS → fast refresh automático. Cambios nativos →
  `./gradlew assembleDebug` + reinstalar.
- Acceso KVM: dado con `chmod 666 /dev/kvm` (inmediato) y grupo `kvm` en tu
  usuario (aplica tras el próximo login; es lo permanente).

### En el navegador (vista rápida, sin celular)

```bash
pnpm web            # → http://localhost:8081 (modo mock)
```

Limitaciones en web: mapa nativo reemplazado por aviso (el botón ABRIR
NAVEGACIÓN abre Google Maps en pestaña), sin push, SecureStore → localStorage.

## Modo mock (sin backend)

Si no hay `EXPO_PUBLIC_API_URL` (o `EXPO_PUBLIC_USE_MOCK=true`), la app corre
completa contra un mock en memoria (`src/api/mock.ts`):

- Login: **`demo` / `demo1234`**
- 5 pedidos precargados en todos los estados (ASSIGNED → IN_DELIVERY) +
  historial con entregados/fallido. Un pedido nuevo "llega" a los 15 s
  (simula el push/socket). Recuperación de contraseña y disponibilidad funcionan.

Copia `.env.example` a `.env` y define `EXPO_PUBLIC_API_URL` para usar el
backend real (contrato en [`docs/maquina-de-estados.md`](docs/maquina-de-estados.md)).

## Notas de implementación

- **Sesión**: tokens Bearer en `expo-secure-store` (web: localStorage solo
  preview); refresh automático en el interceptor de axios; al arrancar se
  valida con `/auth/me`.
- **Estados**: el backend es la única fuente de verdad; la app envía
  transiciones (`accept/arrived/pickup/start/deliver/reject/fail`) según
  `order.status` (`src/delivery/state-machine.ts`). `reject`/`fail` piden motivo.
- **GPS**: solo en `PICKED_UP`/`IN_DELIVERY`, ping cada 15 s o 20 m, cola
  offline con reintento (`src/tracking/`). Background = fase 2.
- **Mapa**: MapLibre + tiles OSM (sin API key); carga dinámica con fallback
  en Expo Go/web; ruta en línea recta en el MVP; navegación externa
  (Google Maps/Waze/Apple Maps).
- **Push**: `expo-notifications` + FCM vía backend; solo en dev build nativo
  (no en Expo Go ni web — el módulo se carga dinámicamente).

## Pendiente (fases 2-3, ver docs/)

- Ruta real y ETA desde el backend (OSRM).
- Background tracking (`expo-task-manager`) y panel de monitoreo.
- Prueba de entrega (foto/firma/OTP). Multi-pedido, navegación integrada,
  liquidación.
