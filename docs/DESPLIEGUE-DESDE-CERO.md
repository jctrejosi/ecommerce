# Despliegue desde cero — requisitos, `.env`, Wompi, Google y apps móviles

> Guía complementaria a [DESPLIEGUE-DOCKER.md](DESPLIEGUE-DOCKER.md). Aquí está
> lo que hay que **instalar antes**, las **credenciales que se deben cambiar** en
> `docker/.env`, la configuración de **Wompi**, **Google OAuth** y la
> compilación/instalación de las **apps móviles**. Para DNS, TLS, Cloudflare,
> firewall y topología, usa la guía de Docker.

El despliegue recomendado es **Docker con un contenedor por servicio**. Las
imágenes compilan Node y Python dentro del contenedor: **no necesitas Node ni
Python en el servidor** para desplegar, salvo que uses `prod.js` o los scripts
`.mjs` del repositorio.

## 0. Resumen

1. Instalar Docker Engine + Compose v2 y `git`.
2. Clonar el repo y crear `docker/.env` desde el ejemplo.
3. Cambiar base de datos, JWT, Basic Auth y medios.
4. Configurar Wompi y Google (si se usan).
5. Construir y levantar con Compose.
6. Compilar e instalar las apps móviles apuntando al servidor correcto.
7. Verificar salud, login con Google y un pago de prueba.

---

## 1. Qué instalar antes

| Componente | Versión recomendada | ¿Dónde? | ¿Para qué? |
|---|---|---|---|
| Linux | Debian 12 / Ubuntu 22.04+ | Servidor | Producción (el VPS actual usa Debian 12) |
| Docker Engine | 24+ (producción: 29.x) | Servidor | Construir y ejecutar los contenedores |
| Docker Compose | v2 (`docker compose`) | Servidor | Orquestar el proyecto `ecommerce` |
| `git` | 2.30+ | Servidor | Clonar y actualizar el repo |
| `curl`, `ca-certificates` | — | Servidor | Healthchecks y salida HTTPS |
| Node.js | 20+ | Servidor **solo si** usas `prod.js` o scripts `.mjs` | Sincronizar `.env`, validar secretos y orquestar |
| `pnpm` | 10.34.3 | Solo desarrollo local de fronts | Las imágenes ya lo activan con `corepack` |
| `yarn` | 1.x | Solo desarrollo local del backend | La imagen usa `yarn.lock` |
| Python | 3.12 | Solo si corres el bot fuera de Docker | La imagen del bot ya trae Python 3.12 |

Recomendaciones de recursos: al construir siete imágenes conviene tener **≥ 4 GB
de RAM** y **≥ 15 GB libres** (imágenes + caché de BuildKit + volúmenes).

### 1.1 Instalar Docker en Debian/Ubuntu

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Cierra sesión y vuelve a entrar (o ejecuta `newgrp docker`) para usar Docker sin
`sudo`. En Ubuntu cambia `debian` por `ubuntu` en la URL del repositorio.

Verificación:

```bash
docker --version
docker compose version          # debe ser v2, no docker-compose v1
docker run --rm hello-world
```

### 1.2 Instalar Node 20 (opcional, para `prod.js`)

Solo hace falta si vas a usar el orquestador `node prod.js` o
`scripts-agent/set-prod-secrets.mjs`. Con NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v      # v20.x o superior
```

Alternativa con `nvm` (útil si el servidor tiene varios proyectos):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### 1.3 Verificación rápida

```bash
docker info >/dev/null && echo "Docker OK"
docker compose version
git --version
node -v 2>/dev/null || echo "Node no instalado (solo válido si despliegas con Compose)"
```

---

## 2. Código y archivo de entorno

```bash
git clone <URL_DEL_REPO> ecommerce
cd ecommerce
git checkout dev

cp docker/.env.example docker/.env
chmod 600 docker/.env
```

- `docker/.env` es el **único** archivo de entorno que leen el backend, el bot y
  el proxy. Los `.env` de cada interfaz son solo para desarrollo local.
- `docker/.env` está ignorado por git (`.env` y `.env.*`). **Nunca** lo subas ni
  lo pegues en un chat.
- Los valores `VITE_*` se **hornean al construir** las SPAs: cambiarlos exige
  reconstruir las imágenes. El resto se aplica al recrear los contenedores
  (`up -d`).

---

## 3. Credenciales que hay que cambiar en `docker/.env`

### 3.1 Obligatorias

Sin estas, el stack no arranca o queda inseguro.

| Variable | Formato / ejemplo | Para qué |
|---|---|---|
| `POSTGRES_USER` | `ecommerce` | Usuario de PostgreSQL del servicio `db` |
| `POSTGRES_PASSWORD` | cadena aleatoria larga | Contraseña de PostgreSQL (no dejes `postgres`) |
| `POSTGRES_DB` | `ecommerce` | Nombre de la base |
| `DATABASE_URL` | `postgres://ecommerce:CLAVE@db:5432/ecommerce` | Conexión del backend y del bot |
| `JWT_SECRET` | 64 caracteres hex | Firma de sesiones de usuarios y clientes |
| `ADMIN_PASSWORD` | cadena aleatoria | Basic Auth de los paneles (usuario `admin`) |
| `ADMIN_PASSWORD_HASH` | hash bcrypt | Alternativa a `ADMIN_PASSWORD`; tiene prioridad |
| `MEDIA_STORAGE` | `local` | Guarda imágenes en el volumen `mercaldas_media` |
| `CLOUDINARY_CLOUD_NAME` | — | Solo si usas `MEDIA_STORAGE=cloudinary` |
| `CLOUDINARY_API_KEY` | — | Solo si usas Cloudinary |
| `CLOUDINARY_API_SECRET` | — | Solo si usas Cloudinary |

Notas:

- Si usas el servicio `db` incluido, `POSTGRES_*` y `DATABASE_URL` deben coincidir.
  Si usas una base externa, cambia solo `DATABASE_URL` y elimina el servicio `db`
  del compose (o ignóralo).
- Si la contraseña de la BD contiene caracteres especiales (`@`, `:`, `/`, `#`),
  codifícala para URL (`@` → `%40`, `:` → `%3A`, etc.) dentro de `DATABASE_URL`.
- Genera los valores, no los inventes:

  ```bash
  openssl rand -hex 32        # JWT_SECRET
  openssl rand -base64 24     # POSTGRES_PASSWORD / ADMIN_PASSWORD
  ```

- `node scripts-agent/set-prod-secrets.mjs` genera `JWT_SECRET` y
  `ADMIN_PASSWORD` si faltan o son débiles. Imprime la contraseña de admin una
  sola vez: guárdala en el gestor de contraseñas.
- `PROTECT_ADMIN=true` es el valor por defecto y es **fail-closed**: sin
  `ADMIN_PASSWORD`/`ADMIN_PASSWORD_HASH`, el proxy no arranca. `ADMIN_USER` es
  opcional (por defecto `admin`).
- Si no quieres Cloudinary, usa `MEDIA_STORAGE=local`. Si lo dejas en
  `cloudinary` sin las tres variables, el backend aborta con
  `Cloudinary credentials are required`.
- **Ojo:** con `NODE_ENV=production` (lo fija la imagen), un `MEDIA_STORAGE`
  vacío se interpreta como `cloudinary`. Define `local` explícitamente si no
  quieres depender de Cloudinary.

### 3.2 Dominios, TLS y proxy

| Variable | Ejemplo | Notas |
|---|---|---|
| `HOST_WEB` | `tienda.tudominio.com` | Web del cliente y API same-origin |
| `HOST_ADMIN` | `admin.tudominio.com` | Panel de administración |
| `HOST_PICKING_ADMIN` | `picking.tudominio.com` | Picking admin |
| `HOST_DELIVERY_ADMIN` | `delivery.tudominio.com` | Delivery admin |
| `HOST_API` | `api.tudominio.com` | API completa y webhooks; sin él no hay host dedicado para Wompi |
| `HOST_*_LEGACY` | `tienda-vieja.tudominio.com` | Alias que sirven lo mismo (migraciones, APKs) |
| `VITE_API_URL` | `https://tienda.tudominio.com` | URL que consume el front; se hornea al construir |
| `CORS_ORIGIN` | `https://tienda.tudominio.com,https://admin.tudominio.com` | Orígenes permitidos si el front llama a otro host |
| `PUBLIC_SCHEME` | `https` | Esquema público real |
| `TLS` | `false` | En modo edge el TLS lo termina el edge compartido |
| `ALLOW_INSECURE` | `true` | Obligatorio para aceptar `TLS=false` |
| `ACME_EMAIL` | `admin@tudominio.com` | Solo en modo TLS directo (Let's Encrypt) |
| `PUBLIC_HTTP_PORT` | `127.0.0.1:30180` | Puerto loopback del proxy; el edge lo alcanza ahí |
| `PUBLIC_HTTPS_PORT` | `127.0.0.1:30181` | Opcional en modo edge |
| `MAX_REQUEST_BODY` | `50MB` | Límite de cuerpo en el borde (`0` = sin límite) |
| `CSP_POLICY` | (vacío) | Política CSP; `off` la desactiva |
| `TRUST_PROXY` | `loopback,uniquelocal` | Ya viene del compose |

> El rate limit de `/auth/*` y `/customer-auth/*` viene **activado en
> `docker/docker-compose.yml`** (`RATE_LIMIT_ENABLED: "true"`). Si necesitas
> cambiarlo, edita el compose, no `docker/.env`.

Sobre `VITE_API_URL`:

- Si el front y el API comparten host (`HOST_WEB`), usa
  `VITE_API_URL=https://<HOST_WEB>`: no hay CORS.
- Si usas `HOST_API` (`prod.js` lo sincroniza así), los paneles y la web llaman
  cross-origin: incluye sus orígenes en `CORS_ORIGIN`.
- Cambiar `VITE_API_URL` **requiere rebuild** de las interfaces.

### 3.3 Servicios externos

| Servicio | Variables | ¿Obligatorio? |
|---|---|---|
| Wompi | `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_KEY`, `WOMPI_API_URL`, `WOMPI_REDIRECT_URL` | Solo si se cobra con Wompi |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REDIRECT_URIS`; `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_REDIRECT_URI` | Solo si se usa login con Google |
| Correo | `RESEND_API_KEY`, `RESEND_SENDER_EMAIL` | Solo si se envían correos |
| Bot de compras | `DEEPSEEK_API_KEY`, `DEEPSEEK_API_URL`, `DEEPSEEK_MODEL` | Solo si se usa el bot |
| ePayco | `EPAYCO_PUBLIC_KEY`, `EPAYCO_PRIVATE_KEY`, `EPAYCO_TEST` | Solo si se usa ePayco |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Solo con `MEDIA_STORAGE=cloudinary` |

Opcionales de ajuste: `JWT_EXPIRES_IN` (def. `7d`), `JWT_REFRESH_EXPIRES_IN` /
`REFRESH_TOKEN_EXPIRES_IN` (def. `30d`), `CUSTOMER_JWT_EXPIRES_IN`,
`CUSTOMER_JWT_REFRESH_EXPIRES_IN`, `VITE_BOT_API_URL`, `BOT_MAX_HISTORY`,
`BOT_MAX_TOKENS`, `BOT_MAX_TOOL_ROUNDS`, `QR_ANALYZER_URL`, `FRONTEND_URL`.

---

## 4. Configurar Wompi

Wompi se usa para **tarjeta, PSE y Nequi**. La tokenización de tarjeta se hace en
el navegador con la llave pública; el backend crea la transacción con la llave
privada y valida la firma de los webhooks con la llave de integridad.

### 4.1 Obtener las credenciales

En el [panel de comercios de Wompi](https://comercios.wompi.co/) (modo pruebas o
producción):

1. Completa el registro/KYC del comercio para producción.
2. En **Desarrolladores → Llaves de API** copia:
   - **Llave pública** (`pub_prod_…` en producción).
   - **Llave privada** (`prv_prod_…`); no la expongas en el frontend.
   - **Llave de integridad** (la que firma el checkout y los eventos).
3. En **Desarrolladores → Eventos/Webhooks** registra la URL del webhook (abajo).
4. Para pruebas usa las llaves de sandbox y las tarjetas de prueba de la
   [documentación de Wompi](https://docs.wompi.co/).

### 4.2 Variables

```dotenv
WOMPI_PUBLIC_KEY=pub_prod_xxxxxxxxxxxxxxxx
WOMPI_PRIVATE_KEY=prv_prod_xxxxxxxxxxxxxxxx
WOMPI_INTEGRITY_KEY=prod_integrity_xxxxxxxxxxxxxxxx
WOMPI_API_URL=https://api.wompi.co/v1
WOMPI_REDIRECT_URL=https://<HOST_WEB>
```

| Variable | Uso |
|---|---|
| `WOMPI_PUBLIC_KEY` | Tokenizar tarjeta y consultar la aceptación (`GET /merchants/:publicKey`) |
| `WOMPI_PRIVATE_KEY` | Crear transacciones (tarjeta, PSE, Nequi) y consultarlas |
| `WOMPI_INTEGRITY_KEY` | Firma de integridad del checkout **y** checksum de los webhooks |
| `WOMPI_API_URL` | `https://api.wompi.co/v1` en producción; sandbox en pruebas |
| `WOMPI_REDIRECT_URL` | A dónde vuelve el usuario tras PSE/Nequi (normalmente la web) |

Sandbox: el código detecta sandbox si la llave pública empieza por `pub_stag_`.
Si tu llave de pruebas usa otro prefijo, fuerza el endpoint:

```dotenv
WOMPI_API_URL=https://sandbox.wompi.co/v1
```

Sin `WOMPI_PRIVATE_KEY`, la creación de transacciones falla; sin
`WOMPI_INTEGRITY_KEY`, los webhooks se rechazan con `503` y los pedidos no pasan
a pagados. Ambas llaves son **solo del servidor**: nunca las pongas en `VITE_*`.

### 4.3 Webhook

URL recomendada:

```text
https://<HOST_API>/webhooks/wompi
```

También puedes registrar `https://<HOST_API>` sin ruta: el proxy reescribe la
raíz a `/webhooks/wompi`. Usa `HOST_API` (no `HOST_WEB`) y HTTPS público.

- Suscribe el evento **`transaction.updated`**. Otros eventos se ignoran.
- El backend valida `X-Event-Checksum` (o `signature.checksum`) contra
  `WOMPI_INTEGRITY_KEY` y **falla cerrado** si falta la firma o la llave.
- Después del checksum, el backend **consulta la transacción a Wompi** y usa ese
  estado, no el cuerpo del webhook, para marcar el pedido.
- Cloudflare debe dejar pasar el POST: desactiva *Bot Fight Mode* y no exijas
  preflight a los webhooks.

Verificación tras un pago de prueba:

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env logs -f backend
# busca: "Webhook firmado correctamente (checksum válido)"
```

Si ves `WOMPI_INTEGRITY_KEY no configurada` o `Firma inválida`, revisa la llave
de integridad y que estés usando la misma cuenta (pruebas vs. producción).

### 4.4 Métodos de pago

El backend expone `GET /payments/methods` y `GET /payments/wompi/config`. Los
métodos se guardan en la tabla `settings`, clave `payment_methods`, y se editan
desde el panel de administración:

```json
{
  "efectivo": { "enabled": true },
  "wompi": { "enabled": true, "methods": { "card": true, "pse": true, "nequi": true } },
  "breb": { "enabled": true, "key": "@usuario", "bank": "Davivienda" }
}
```

Al activar Wompi, el backend valida las credenciales y exige al menos un método
(tarjeta, PSE o Nequi). Bre-B es independiente de Wompi y usa su propia llave
(`breb.key`).

### 4.5 Checklist de Wompi

- [ ] Llaves de la cuenta correcta (pruebas o producción).
- [ ] `WOMPI_INTEGRITY_KEY` configurada (checkout + webhook).
- [ ] Webhook `https://<HOST_API>/webhooks/wompi` suscrito a `transaction.updated`.
- [ ] Al menos un método habilitado en `payment_methods`.
- [ ] Pago de prueba aprobado y pedido en `paid`.
- [ ] Log del webhook con checksum válido.
- [ ] Para producción: KYC aprobado y llaves `prod_*`.

---

## 5. Configurar Google OAuth

El login de clientes usa **OAuth 2.0 con flujo de código**: el front redirige a
Google, recibe `?code=…`, y el backend lo canjea con el client secret. El client
ID es público; el secret **solo** va en el backend.

### 5.1 Configurar en Google Cloud Console

1. Crea o selecciona un proyecto en <https://console.cloud.google.com>.
2. Configura la **pantalla de consentimiento OAuth**:
   - Tipo: externo (o interno si usas Google Workspace).
   - Scopes: `openid`, `email`, `profile`.
   - Publica la app o agrega usuarios de prueba mientras validas.
3. Ve a **[Credenciales → Crear credenciales → ID de cliente de OAuth](https://console.cloud.google.com/apis/credentials)**.
4. Tipo de aplicación: **Aplicación web**.
5. **Orígenes JavaScript autorizados** (sin path, sin barra final):
   - `https://<HOST_WEB>`
   - `http://localhost:4173` (desarrollo)
   - Si usas dominios legacy, agrégalos también.
6. **URIs de redireccionamiento autorizados**: los mismos orígenes.
   El flujo usa el origen de la web como `redirect_uri`; si configuras
   `VITE_GOOGLE_REDIRECT_URI`, debe coincidir exactamente.
7. Copia el **Client ID** y el **Client Secret**.

### 5.2 Variables

```dotenv
# Frontend (público; se hornea al construir)
VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
VITE_GOOGLE_REDIRECT_URI=https://<HOST_WEB>

# Backend (privado)
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=https://<HOST_WEB>
# Opcional: orígenes extra aceptados por el backend, separados por coma
GOOGLE_REDIRECT_URIS=https://<HOST_WEB_LEGACY>
```

Reglas:

- `VITE_GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_ID` deben ser el **mismo** client ID.
- Si falta `VITE_GOOGLE_CLIENT_ID`, el botón de Google aparece deshabilitado.
- Si falta `GOOGLE_CLIENT_ID` o `GOOGLE_CLIENT_SECRET`, el backend responde
  `Google login no está configurado en el servidor`.
- `VITE_GOOGLE_REDIRECT_URI` es opcional: por defecto se usa el origen HTTPS
  actual; en HTTP local se usa `http://localhost:4173`.
- El backend acepta como `redirect_uri` el valor configurado, la lista
  `GOOGLE_REDIRECT_URIS`, `http://localhost:4173` y el origen de la petición.
  Cualquier otro valor se rechaza con `redirect_uri no permitido`.
- La política CSP por defecto permite `https:` en scripts, conexiones y
  `form-action`; si defines `CSP_POLICY`, no bloquees
  `accounts.google.com` ni `oauth2.googleapis.com`.
- En la APK, el WebView intercepta `http://localhost:4173` y lo reescribe al
  origen real; registra ese loopback en Google si compilas la app móvil.

### 5.3 Aplicar cambios

`VITE_GOOGLE_*` se hornean en el bundle:

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env build
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d
```

Solo el backend (secret y redirects) requiere `up -d`; el front requiere rebuild.

### 5.4 Verificación

1. Abre `https://<HOST_WEB>` en incógnito.
2. Pulsa **Iniciar sesión con Google**.
3. Debe redirigir a `accounts.google.com` y volver a la web con sesión creada.
4. Revisa que la URL de retorno no muestre `redirect_uri_mismatch`.

| Síntoma | Causa / solución |
|---|---|
| Botón de Google deshabilitado | Falta `VITE_GOOGLE_CLIENT_ID` o no se reconstruyó el front |
| `redirect_uri_mismatch` | El origen no está en Google Console; agrégalo exacto (https, sin `/`) |
| `Google login no está configurado en el servidor` | Faltan `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` |
| `redirect_uri no permitido` | Añade el origen a `GOOGLE_REDIRECT_URI` o `GOOGLE_REDIRECT_URIS` |
| `Token de Google inválido` | El client ID del front no coincide con el del backend |
| La CSP bloquea el login | Revisa `CSP_POLICY` y permite los dominios de Google |

---

## 6. Primer despliegue

### 6.1 Preparar secretos

```bash
cp docker/.env.example docker/.env
chmod 600 docker/.env
# edita docker/.env (§3)
node scripts-agent/set-prod-secrets.mjs   # opcional, requiere Node 20+
```

### 6.2 Opción A — orquestador `prod.js` (requiere Node)

```bash
node prod.js            # sincroniza dominios desde prod.config.json, valida y levanta
node prod.js --with-db  # incluye la base de datos
node prod.js --status
```

`prod.js` sincroniza `HOST_*`, `VITE_API_URL`, TLS y puertos desde
`prod.config.json`, **sin pisar los secretos**. Si falta algo obligatorio,
aborta antes de construir.

### 6.3 Opción B — Compose manual (sin Node en el host)

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env build
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d
docker compose -f docker/docker-compose.yml --env-file docker/.env ps
docker compose -f docker/docker-compose.yml --env-file docker/.env logs -f backend
```

El primer arranque aplica `db/docker/init.sql` si la base está vacía y el
entrypoint del backend sincroniza el esquema de forma idempotente.

### 6.4 Edge y DNS

El proyecto publica solo en `127.0.0.1:30180`; el **edge compartido** es el que
expone 80/443 y termina TLS. Si es un servidor nuevo:

1. Sigue [DESPLIEGUE-DOCKER.md §4](DESPLIEGUE-DOCKER.md) para DNS, Cloudflare y
   certificado de origen.
2. Levanta el proyecto del [edge](../docker/edge/README.md).
3. Abre solo 80/443 en el firewall; **no** expongas `3100`, `8001`, `5432` ni
   `30180`.

### 6.5 Checklist de primer despliegue

- [ ] `docker compose ... ps` muestra todos los servicios `healthy`.
- [ ] `https://<HOST_WEB>/api-status` responde.
- [ ] `https://<HOST_WEB>/discovery` devuelve `mercaldas-backend`.
- [ ] `https://<HOST_API>/api-status` responde.
- [ ] Paneles protegidos con Basic Auth (`PROTECT_ADMIN=true` + contraseña).
- [ ] `https://<HOST_API>/webhooks/wompi` existe y responde a Wompi.
- [ ] Login con Google funciona.
- [ ] `GET /payments/wompi/config` devuelve `publicKey` y tokens de aceptación.
- [ ] Un pago de prueba deja el pedido en `paid` y el webhook en logs.
- [ ] `3100`, `8001`, `5432` y `30180` no son accesibles desde fuera.

---

## 7. Apps móviles y de escritorio

Las apps **no se instalan en el servidor**. Las móviles son APK de Android que se
compilan en un equipo de desarrollo y se instalan en los teléfonos; las de
escritorio son instaladores Electron para Windows. Las móviles viven en:

| App | Carpeta | Paquete Android | APK generado |
|---|---|---|---|
| Cliente | `Interface movil client` | `com.dsi.mercaldasclient` | `dist/EcommerceClient-<version>.apk` |
| Delivery | `Interface movil delivery` | `com.dsi.deliveryapp` | `dist/EcommerceDelivery-<version>.apk` |
| Picking | `Interface movil picking` | `com.dsi.pickingapp` | `dist/EcommercePicking-<version>.apk` |

Las tres usan **Expo SDK 57 + React Native 0.86** y `pnpm@10.34.3`.

### 7.1 Requisitos para compilar

| Componente | Versión | Nota |
|---|---|---|
| Node.js | 20+ | Igual que el resto del repo |
| pnpm | 10.34.3 | `corepack` lo activa |
| JDK | 17 (o 21) | Los scripts usan JDK 17 por defecto |
| Android SDK | build-tools + platform-tools | `adb` incluido |
| Keystore de firma | `signing/ecommerce-jcti.jks` | No está en git; se copia del respaldo seguro |
| `google-services.json` | Ya incluido por app | Solo se reemplaza si cambias el proyecto Firebase |

```bash
corepack enable
corepack prepare pnpm@10.34.3 --activate

export ANDROID_HOME="$HOME/Android/Sdk"
export JAVA_HOME="/ruta/al/jdk-17"      # los scripts asumen JDK 17
export PATH="$ANDROID_HOME/platform-tools:$PATH"
adb devices
```

Cada `build-apk.sh` trae rutas por defecto (`/home/jk/jdks/...`,
`/home/jk/Android/Sdk`). Si en el equipo nuevo están en otro sitio, exporta
`JAVA_HOME` y `ANDROID_HOME` antes de compilar.

### 7.2 Firma de release

Cada app tiene su propia carpeta `signing/`:

```text
signing/ecommerce-jcti.jks
signing/ecommerce-signing.properties
```

Ambos están ignorados por git y **no vienen en un clon nuevo**. Cópialos desde el
respaldo seguro (gestor de contraseñas) a cada app que vayas a compilar:

```bash
cp /ruta/segura/ecommerce-jcti.jks "Interface movil client/signing/"
cp /ruta/segura/ecommerce-signing.properties "Interface movil client/signing/"
```

La plantilla `ecommerce-signing.properties.example` muestra las claves
(`storeFile`, `storePassword`, `keyAlias`, `keyPassword`); el alias es
`ecommerce-jcti`. Si falta el `.properties`, `build-apk.sh` aborta para no
publicar un APK firmado con la clave de debug.

### 7.3 Qué URL debe apuntar al servidor correcto

| App | Variable al compilar | Valor | Archivo de respaldo en el código |
|---|---|---|---|
| Cliente | `EXPO_PUBLIC_WEB_URL` | `https://<HOST_WEB>` | `src/webview.ts` (`WEB_CLIENT_URL`) y `app.json` → `extra.apiUrl` |
| Delivery | `EXPO_PUBLIC_API_URL` | `https://<HOST_API>` | `src/api/server.ts` |
| Picking | `EXPO_PUBLIC_API_URL` | `https://<HOST_API>` | `src/api/apiConfig.ts` |

Reglas:

- `EXPO_PUBLIC_*` se **inyecta al compilar**: cambiar el `.env` del servidor no
  cambia un APK ya instalado. Hay que reconstruirlo.
- Las `VITE_*` del frontend web **no** afectan a las apps móviles.
- **Cliente**: es un WebView de la web del cliente. Debe apuntar a `HOST_WEB`,
  que sirve la web, el API same-origin y `/discovery`. No lo apuntes al host del
  API.
- **Delivery y picking**: llaman al backend directamente. Deben apuntar a
  `HOST_API` (o a `HOST_WEB` si usas el API same-origin, pero el canónico es
  `HOST_API`).
- Los valores por defecto del código siguen siendo los antiguos
  `https://ecommerce.jcti.xyz` y `https://ecommerce-api.jcti.xyz`. Si no pasas la
  variable al compilar, el APK usará esos hosts. Cámbialos en el código o, mejor,
  pasa siempre `EXPO_PUBLIC_*` en el build.
- Si el despliegue usa los hosts de `prod.config.json`, el ejemplo es:

  ```bash
  EXPO_PUBLIC_WEB_URL="https://mercaldas.jcti.xyz"
  EXPO_PUBLIC_API_URL="https://mercaldas-api.jcti.xyz"
  ```

  Confirma los valores reales en `docker/.env` antes de compilar.

### 7.4 Compilar los APK

```bash
cd "Interface movil client"
pnpm install --frozen-lockfile
EXPO_PUBLIC_WEB_URL="https://<HOST_WEB>" ./build-apk.sh
# → dist/EcommerceClient-<version>.apk
```

```bash
cd "Interface movil delivery"
pnpm install --frozen-lockfile
EXPO_PUBLIC_API_URL="https://<HOST_API>" ./build-apk.sh
# → dist/EcommerceDelivery-<version>.apk
```

```bash
cd "Interface movil picking"
pnpm install --frozen-lockfile
EXPO_PUBLIC_API_URL="https://<HOST_API>" ./build-apk.sh
# → dist/EcommercePicking-<version>.apk
```

`build-apk.sh` hace todo el flujo: aplica la firma de release, ejecuta
`./gradlew assembleRelease`, verifica el APK con `apksigner` y lo copia a
`dist/`. Con `--install` además lo instala por USB:

```bash
EXPO_PUBLIC_API_URL="https://<HOST_API>" ./build-apk.sh --install
```

Si la carpeta `android/` no existe en el equipo nuevo (está ignorada por git),
génerala una vez antes de compilar:

```bash
npx expo prebuild --platform android
```

Variantes útiles:

```bash
# APK solo arm64 (más pequeño), desde la raíz de la app
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a

# AAB para Google Play (ya dentro de android/)
./gradlew bundleRelease
```

### 7.5 Instalar en el teléfono

1. Activa **Opciones de desarrollador → Depuración USB** en el Android.
2. Conéctalo por USB y autoriza el equipo.
3. Verifica que aparezca:

   ```bash
   adb devices
   ```

4. Instala el APK (o usa `./build-apk.sh --install`):

   ```bash
   adb install -r dist/EcommerceClient-<version>.apk
   adb install -r dist/EcommerceDelivery-<version>.apk
   adb install -r dist/EcommercePicking-<version>.apk
   ```

5. Si lo copias por WhatsApp/almacenamiento, habilita **“Instalar apps
   desconocidas”** para esa fuente.

Errores de instalación:

| Error | Causa | Solución |
|---|---|---|
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Paquete con otra firma o versión | Usa el mismo keystore; si no, `adb uninstall <paquete>` (borra datos) |
| `INSTALL_FAILED_INSUFFICIENT_STORAGE` | Poco espacio | Desinstala la versión anterior o libera espacio |
| `INSTALL_PARSE_FAILED_NO_CERTIFICATES` | APK corrupto o sin firmar | Recompila con `./build-apk.sh` |
| No aparece en el launcher | Paquete distinto | Revisa `adb shell pm list packages \| grep com.dsi` |

### 7.6 Cambiar de servidor sin recompilar

Las apps **no tienen un campo manual de servidor** en la versión actual: buscan
solas el backend y guardan la URL que responde. El orden es:

1. URL guardada en el dispositivo.
2. Pista del build (`EXPO_PUBLIC_*`).
3. Valor por defecto del código.
4. Barrido de la subred local (solo si la URL es HTTP).

| App | Clave guardada | Cómo forzar la búsqueda |
|---|---|---|
| Cliente | `mercaldas_web_url` | Borra datos de la app |
| Delivery | `dsi_delivery_server_url` | Borra datos de la app |
| Picking | `picking.apiUrl` | Borra datos de la app |

```bash
adb shell pm clear com.dsi.mercaldasclient
adb shell pm clear com.dsi.deliveryapp
adb shell pm clear com.dsi.pickingapp
```

Esto cierra la sesión y borra la URL guardada; los pedidos y datos del servidor
no se tocan. Al abrir de nuevo, la app usa la pista del build o vuelve a buscar.

- En **producción HTTPS**, delivery y picking **no barren la LAN**: si la pista
  del build es incorrecta, no conectarán. Hay que recompilar con el host bueno.
- En **LAN/desarrollo**, el cliente busca `http://<ip>:4173` y delivery/picking
  `http://<ip>:3000`. El emulador usa `http://10.0.2.2:4173` y
  `http://10.0.2.2:3000` respectivamente.
- El cliente requiere que el servidor web exponga `/discovery`
  (`service: "mercaldas-webclient"`) o, en HTTPS, que la raíz responda.
- Delivery acepta `/discovery` o `/api-status`; picking usa `/api-status`
  (`status: "ok"`).
- Para desarrollo del cliente:

  ```bash
  node dev.js --webclient
  # o: node scripts-agent/serve-webclient.mjs 4173
  ```

### 7.7 Versión, actualización y Play

- Para actualizar una app instalada se necesita **el mismo paquete y la misma
  firma**. Si cambias `applicationId` o el keystore, Android la trata como otra
  app (hay que desinstalar).
- Sube `expo.version` en `app.json` (de ahí sale el nombre del APK) y el
  `versionCode` en `android/app/build.gradle` (o regenera `android/` con
  `npx expo prebuild` después de subir la versión).
- Google Play: sube el AAB (`./gradlew bundleRelease`) y registra la huella
  SHA-256 del keystore `ecommerce-jcti`. Si usas Play App Signing, conserva igual
  el keystore como upload key.
- `google-services.json` es para **push (FCM)**; no cambia la URL del API. Solo
  reemplázalo si cambias de proyecto Firebase.
- El login con Google dentro del WebView usa la configuración web de §5
  (`VITE_GOOGLE_CLIENT_ID` y orígenes autorizados). La pantalla nativa antigua
  (`account.tsx`) usa `EXPO_PUBLIC_GOOGLE_CLIENT_ID` y un cliente OAuth de Android
  con el paquete y SHA-1 de la app.

### 7.8 Checklist de apps

- [ ] `HOST_WEB` y `HOST_API` finales, con HTTPS.
- [ ] `EXPO_PUBLIC_WEB_URL` / `EXPO_PUBLIC_API_URL` correctos en cada build.
- [ ] `signing/ecommerce-jcti.jks` y `ecommerce-signing.properties` presentes.
- [ ] `android/` existe o se generó con `npx expo prebuild`.
- [ ] APK firmado con `CN=ecommerce-jcti`.
- [ ] Paquete instalado correcto (`com.dsi.mercaldasclient`, `com.dsi.deliveryapp`, `com.dsi.pickingapp`).
- [ ] La app encuentra el servidor o usa la pista del build.
- [ ] Login con Google y push (si se usan) funcionan.
- [ ] Apps de escritorio con `adminUrl` apuntando a los paneles correctos.

### 7.9 Apps de escritorio (Electron)

Las tres apps de escritorio (`Interface desktop admin`, `Interface desktop
delivery admin`, `Interface desktop picking admin`) son envoltorios Electron de
los paneles web. **No llevan la URL compilada**: la leen de `config.json` o
`config.local.json`.

| App | Panel que abre | `adminUrl` |
|---|---|---|
| Admin | `HOST_ADMIN` | `https://<HOST_ADMIN>` |
| Delivery admin | `HOST_DELIVERY_ADMIN` | `https://<HOST_DELIVERY_ADMIN>` |
| Picking admin | `HOST_PICKING_ADMIN` | `https://<HOST_PICKING_ADMIN>` |

1. Crea `config.local.json` a partir de `config.json` (está ignorado por git) y
   cambia la URL:

   ```json
   {
     "adminUrl": "https://<HOST_ADMIN>",
     "allowDevTools": false
   }
   ```

2. Compila con Node/npm:

   ```bash
   npm install
   npm run build:win          # instalador por usuario (sin admin)
   npm run build:win:admin    # AllInOne (UAC, Program Files)
   ```

   Salidas:

   - `dist/EcommerceAdmin-Setup-<version>.exe`
   - `dist/EcommerceDeliveryAdmin-Setup-<version>.exe`
   - `dist/EcommercePickingAdmin-Setup-<version>.exe`

3. Instala el `.exe` en el equipo Windows. La app busca la configuración en este
   orden: `config.local.json` junto al `.exe`, `config.json` junto al `.exe`,
   luego en `resources/` y por último en la carpeta de la app. Edita el archivo
   que corresponda y reinicia la app. El instalador **no sobrescribe** un
   `config.json` existente en una actualización.

4. Los instaladores están firmados con el certificado autofirmado
   `Ecommerce-JCTI Code Signing`. Antes de instalar en un equipo, importa
   `deployment/Ecommerce-JCTI-CodeSigning.cer` en
   `LocalMachine\Root` y `LocalMachine\TrustedPublisher` (por GPO/Intune o con
   `Install-EcommerceCodeSigningCert.ps1`). Sin el certificado, SmartScreen puede
   advertir. El `.pfx` y su contraseña se quedan solo en el equipo que compila;
   nunca se versionan.

5. `config.local.json` solo contiene la URL del panel y flags como
   `allowDevTools`; no guarda credenciales.

---

## 8. Problemas típicos

| Síntoma | Causa probable | Solución |
|---|---|---|
| `JWT_SECRET is required` | Falta la variable | Genera y define `JWT_SECRET` |
| El proxy reinicia en bucle | `PROTECT_ADMIN=true` sin contraseña | Define `ADMIN_PASSWORD` o `ADMIN_PASSWORD_HASH` |
| El backend reinicia en bucle | Cloudinary incompleto | Usa `MEDIA_STORAGE=local` o define las tres `CLOUDINARY_*` |
| `Cloudinary credentials are required` | `MEDIA_STORAGE=cloudinary` sin llaves | Cambia a `local` o completa las llaves |
| `port is already allocated` | Otro proceso usa 30180/5432 | Cambia `PUBLIC_HTTP_PORT`/`DB_PUBLISH_PORT` o detén el conflicto |
| `permission denied` al usar Docker | Usuario sin grupo `docker` | `sudo usermod -aG docker $USER` y vuelve a entrar |
| El front llama al API equivocado | `VITE_API_URL` mal o sin rebuild | Corrige y reconstruye las interfaces |
| CORS en los paneles | `CORS_ORIGIN` no incluye el origen | Agrega el origen exacto (con `https://`) |
| Google deshabilitado | Falta `VITE_GOOGLE_CLIENT_ID` | Define y reconstruye |
| Wompi no cobra | Falta `WOMPI_PRIVATE_KEY` | Configura la llave privada de la cuenta correcta |
| Webhooks rechazados | Falta o no coincide `WOMPI_INTEGRITY_KEY` | Usa la llave de integridad de la misma cuenta |
| Wompi en sandbox falla | `WOMPI_API_URL` apunta a producción | Fija `https://sandbox.wompi.co/v1` |
| Cloudflare bloquea webhooks | Bot Fight Mode activo | Desactívalo para el host del API |
| La app no encuentra el servidor | `EXPO_PUBLIC_*` viejo o host equivocado | Recompila con el host actual; limpia datos de la app |
| El cliente abre el dominio viejo | `WEB_CLIENT_URL`/`EXPO_PUBLIC_WEB_URL` antiguos | Actualiza el código o pasa la variable al compilar |
| Delivery/picking no conectan en producción | Pista HTTPS incorrecta; no hay barrido LAN | Recompila con `EXPO_PUBLIC_API_URL` correcto |
| APK no compila: falta firma | No existe `signing/ecommerce-signing.properties` | Cópialo del respaldo seguro |
| APK no compila: falta `android/` | Proyecto nativo no generado | `npx expo prebuild --platform android` |
| No se puede actualizar la app | Firma o paquete distinto | Usa el mismo keystore/paquete o desinstala |
| La app de escritorio abre el panel viejo | `adminUrl` desactualizado | Edita `config.json`/`config.local.json` junto al `.exe` y reinicia |
| Windows no confía en el instalador | Falta el certificado de firma | Importa el `.cer` en Root y TrustedPublisher |

---

## 9. Seguridad mínima

1. `docker/.env` con permisos `600` y dueño del usuario que despliega.
2. Nunca versionar `.env`, llaves ni dumps; `.gitignore` ya los excluye.
3. `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_KEY`, `GOOGLE_CLIENT_SECRET`,
   `JWT_SECRET` y `CLOUDINARY_API_SECRET` son **solo del servidor**.
4. No reutilices la contraseña de PostgreSQL ni la de admin en otros servicios.
5. Usa HTTPS público (Cloudflare o Let's Encrypt) para OAuth y webhooks.
6. Rota las credenciales si se compartieron en un chat, issue o captura.
7. Revisa [docs/SECURITY.md](SECURITY.md) para firewall, CSP y hardening del
   servidor.
