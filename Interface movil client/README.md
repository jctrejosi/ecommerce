# Mercaldas — App móvil del cliente (WebView)

La app **envuelve la interface web del cliente** (`Interface web client`) en un
WebView: la web renderiza todo (inicio, catálogo, detalle, carrito, checkout,
cuenta, rastreo…) y la app solo aporta el contenedor y **descubre el servidor**
en la red local, para que el APK siga funcionando aunque cambie la IP del
servidor o la red del celular.

- Paquete Android: `com.dsi.mercaldasclient`
- Etiqueta del launcher: **Mercaldas** (viene de
  `android/app/src/main/res/values/strings.xml`, no de `app.json`)

## Arquitectura

```
Interface movil client (APK)
 ├─ app/_layout.tsx      Stack raíz (sin headers)
 ├─ app/index.tsx        máquina de estados: searching → ready | notfound
 ├─ src/server.ts        descubrimiento del servidor
 ├─ src/components/ServerSetup.tsx  pantalla "no encontramos el servidor"
 └─ WebView ──────────► http://<ip-lan>:4173   (scripts-agent/serve-webclient.mjs)
                                  │
                                  ├─ estáticos de `Interface web client/dist`
                                  ├─ proxy mismo-origen → backend NestJS :3000
                                  ├─ proxy mismo-origen → bot FastAPI :8000
                                  ├─ /socket.io/* (WebSocket) → backend :3000
                                  └─ /discovery → identifica el servicio
```

La web se sirve y consume su API **desde el mismo origen** (`:4173`), así que no
hay CORS ni URLs de API compiladas dentro del build (ver
`Interface web client/.env.production`).

### Descubrimiento del servidor

`src/server.ts` resuelve la URL en este orden y **valida cada candidato** con
`GET /discovery` (espera `service: "mercaldas-webclient"`):

1. la URL guardada en el dispositivo (`AsyncStorage`, clave `mercaldas_web_url`),
2. `EXPO_PUBLIC_WEB_URL` (pista de compilación, opcional),
3. la pista de `src/webview.ts` (`WEB_CLIENT_URL`, opcional — solo acelera el
   arranque en frío cuando acierta),
4. **escaneo de la subred**: recorre `<prefijo-del-celular>.1..254:4173` en lotes
   de 40 (timeout 600 ms) buscando el primer host que responda `/discovery`.

La URL que responde se guarda para los siguientes arranques. Se vuelve a
resolver:

- al abrir la app,
- cuando cambia el prefijo /24 de la red del celular (polling cada 5 s, porque
  `expo-network` no expone listener),
- si el documento principal del WebView falla (hasta 2 reintentos automáticos);
  si aun así no hay servidor, aparece `ServerSetup`, que permite reintentar o
  escribir la IP a mano.

El APK permite HTTP en claro a cualquier host (`usesCleartextTraffic`), necesario
para hablar con una IP de LAN arbitraria.

## Levantar el servidor que consume el APK

```bash
# 1. build de la web del cliente (una vez, y tras cada cambio):
cd "Interface web client" && npm run build

# 2. servidor de la web + API (mismo-origen) en 0.0.0.0:4173:
node dev.js --webclient      # desde la raíz del repo (levanta también el backend)
# o directamente:
node scripts-agent/serve-webclient.mjs 4173
```

Diagnóstico rápido:

```bash
curl http://<ip-de-tu-maquina>:4173/discovery
# {"service":"mercaldas-webclient","name":"Mercaldas","port":4173,...}

# ¿el escaneo del celular encontraría el servidor? (barrido desde la máquina)
node scripts-agent/test-scan-subnet.mjs 192.168.0. 4173
```

## Desarrollo

```bash
pnpm install
pnpm typecheck        # verificación de tipos
```

Las pantallas nativas de la primera versión (`app/account.tsx`, `app/cart.tsx`,
`app/checkout.tsx`, `app/catalog.tsx`, `app/product/`, `src/api/`, `src/stores/`,
`src/components/landing/`) siguen en el repo por si se revierte el enfoque, pero
**ya no se navegan**: nada del WebView llama a `router.push`.

## Generar el APK

```bash
cd android
ANDROID_HOME=/ruta/al/Android/Sdk ./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a
# APK: app/build/outputs/apk/release/app-release.apk (~47 MB)
```

- Sin `-PreactNativeArchitectures` el APK universal pesa ~104 MB.
- En esta máquina no había JDK (solo JRE), por eso hay un Temurin 21 portátil en
  `.jdk/` apuntado desde `android/gradle.properties` (`org.gradle.java.home`).
  Si instalas un JDK normal puedes quitar esa línea.

Instalar en un dispositivo conectado:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

> Si falla con `INSTALL_FAILED_INSUFFICIENT_STORAGE`, desinstala primero
> (`adb uninstall com.dsi.mercaldasclient`) y vuelve a instalar.
