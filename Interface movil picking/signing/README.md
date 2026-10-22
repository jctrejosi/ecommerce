# Firma de release — ecommerce-jcti

La app se firma con el keystore `signing/ecommerce-jcti.jks`, alias
`ecommerce-jcti` (RSA 4096, validez 10 000 días).

| Dato | Valor |
|---|---|
| Alias | `ecommerce-jcti` |
| SHA-1 | `D9:2C:86:A3:65:E7:EA:A1:19:58:2D:00:81:0C:D4:AF:21:85:06:26` |
| SHA-256 | `46:48:FF:95:4B:E5:60:BA:5E:F6:4E:44:02:2B:1D:65:AD:4A:42:DE:3D:92:70:CD:5D:7E:7B:E2:4F:24:7C:8C` |

## Archivos

- `ecommerce-jcti.jks`: keystore con la clave privada. **Nunca** se versiona.
- `ecommerce-signing.properties`: ruta y contraseñas del keystore. **Nunca** se
  versiona.
- `ecommerce-signing.properties.example`: plantilla sin credenciales.

Ambos están en `.gitignore`. Guarda una copia segura fuera del repositorio: si
pierdes el keystore no podrás publicar actualizaciones de esta app (salvo que
uses Play App Signing y Google conserve la clave).

## Cómo se aplica

La carpeta `android/` la genera Expo y está ignorada por git. Antes de compilar:

```bash
./build-apk.sh
```

El script ejecuta `scripts/apply-release-signing.cjs`, que inyecta en
`android/app/build.gradle` la lectura de `signing/ecommerce-signing.properties`
y usa esa firma en `release`. Es idempotente: puedes ejecutarlo también después
de `npx expo prebuild`.

Si falta `ecommerce-signing.properties`, el build de release se detiene con un
error para no publicar un APK firmado con la clave de debug.

## Verificar

```bash
apksigner verify --print-certs dist/EcommercePicking-<version>.apk
```

Debe mostrar `CN=ecommerce-jcti` y el SHA-256 de la tabla.

## Google Play

Al registrar la app, sube el AAB (`./gradlew bundleRelease`) y declara esta
huella SHA-256 en Play Console. Si usas Play App Signing, Google administra la
clave de distribución; conserva igualmente este keystore para la clave de carga
(upload key).
