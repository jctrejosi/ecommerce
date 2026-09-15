# Picking DSI — App móvil (React Native / Expo)

App móvil de alistamiento (picking) para los pickers de bodega. Es el port a
React Native de la `Interface web picking`, con la misma lógica de negocio y
contra los mismos endpoints del backend (`/picking/*`, `/picking-admin/*`).

## Stack

- **Expo SDK 57** + **expo-router** (navegación por archivos).
- **@tanstack/react-query** para datos (polling + invalidación).
- **zustand** + **AsyncStorage** para la sesión del picker.
- **socket.io-client** contra el namespace `/picking-events` (tiempo real).
- **expo-camera** para el escaneo de códigos de barras.
- **axios** como cliente HTTP.

## Pantallas

| Ruta | Descripción |
| --- | --- |
| `app/login.tsx` | Login (usuario/correo + contraseña). Es la pantalla inicial si no hay sesión. |
| `app/(main)/index.tsx` | Cola de pedidos con filtros (Nuevos / Preparando / Completados). |
| `app/(main)/order/[id].tsx` | Detalle del pedido: progreso y lista de productos. |
| `app/(main)/scanner/[id].tsx` | Escáner con cámara + ingreso manual del código. |
| `app/(main)/checklist/[id].tsx` | Verificación final y confirmación de entrega en caja. |
| `app/(main)/success/[id].tsx` | Confirmación de entrega. |
| `app/(main)/map/[id].tsx` | Mapa de bodega con la ubicación resaltada. |

## Configuración

La app **descubre el backend sola** en la red local: primero prueba la URL
activa (guardada localmente; si no hay, la de `EXPO_PUBLIC_API_URL`, con
`http://10.0.2.2:3000` por defecto para el emulador) y, si no responde, barre la
subred del dispositivo buscando quién responda `/api-status` en el puerto `3000`.
La URL encontrada se guarda y se reutiliza en los siguientes arranques.

Esa búsqueda se repite cuando la app **vuelve a primer plano** y cuando **cambia
la conectividad** (otra Wi-Fi, se cayó la red), así que no hay que reconfigurar la
IP al cambiar de red. Mientras busca se muestra un aviso; si no encuentra nada,
pide reintentar. También se puede forzar desde **Ajustes → Buscar servidor ahora**.

`EXPO_PUBLIC_API_URL` solo fija la URL inicial sugerida:

```bash
# ejemplo con archivo .env
EXPO_PUBLIC_API_URL=http://192.168.1.50:3000
```

> El acceso usa los **usuarios del panel de picking** (`POST /auth/login`). La
> sesión se guarda localmente y vence al final del turno (horario de la sucursal)
> o por inactividad; un `401` redirige al login.

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
