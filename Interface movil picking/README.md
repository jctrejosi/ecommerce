# Picking DSI — App móvil (React Native / Expo)

App móvil de alistamiento (picking) para los pickers de bodega. Es el port a
React Native de la `Interface web picking`, con la misma lógica de negocio y
contra los mismos endpoints del backend (`/picking/*`, `/picking-admin/*`).

## Stack

- **Expo SDK 57** + **expo-router** (navegación por archivos).
- **@tanstack/react-query** para datos (polling + invalidación).
- **zustand** + **AsyncStorage** para el picker activo.
- **socket.io-client** contra el namespace `/picking-events` (tiempo real).
- **expo-camera** para el escaneo de códigos de barras.
- **axios** como cliente HTTP.

## Pantallas

| Ruta | Descripción |
| --- | --- |
| `app/(main)/index.tsx` | Cola de pedidos con filtros (Nuevos / Preparando / Completados) y selección del picker. |
| `app/(main)/order/[id].tsx` | Detalle del pedido: progreso y lista de productos. |
| `app/(main)/scanner/[id].tsx` | Escáner con cámara + ingreso manual del código. |
| `app/(main)/checklist/[id].tsx` | Verificación final y confirmación de entrega en caja. |
| `app/(main)/success/[id].tsx` | Confirmación de entrega. |
| `app/(main)/map/[id].tsx` | Mapa de bodega con la ubicación resaltada. |

## Configuración

La URL del backend se toma de `EXPO_PUBLIC_API_URL`. Por defecto apunta a
`http://10.0.2.2:3000` (host visto desde el emulador de Android).

- **Emulador Android:** funciona sin configurar nada (`10.0.2.2` = tu máquina).
- **iOS Simulator / web:** usa `http://localhost:3000`.
- **Dispositivo físico:** usa la IP de tu máquina en la red local.

```bash
# ejemplo con archivo .env
EXPO_PUBLIC_API_URL=http://192.168.1.50:3000
```

> Los endpoints de picking son **anónimos** (no requieren login). El "picker" se
> elige dentro de la app y se guarda localmente (`picking.pickerId`).

## Comandos

```bash
pnpm install
pnpm start        # servidor de desarrollo Expo
pnpm android      # build/run en Android
pnpm ios          # build/run en iOS
pnpm typecheck    # tsc --noEmit
```

## Estructura

```
app/            rutas (expo-router)
src/api/        cliente axios, tipos y funciones del backend
src/picking/    hooks de react-query, store del picker, helpers de estado
src/ui/         componentes de UI reutilizables
src/lib/        utilidades (formato, queryClient)
src/socket.ts   conexión al namespace /picking-events
src/theme.ts    tema oscuro (paleta de la web picking)
```
