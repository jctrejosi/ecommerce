# Firma de release — ecommerce-jcti

La app se firma con el keystore `signing/ecommerce-jcti.jks`, alias
`ecommerce-jcti` (RSA 4096, validez 10 000 días).

| Dato | Valor |
|---|---|
| Alias | `ecommerce-jcti` |
| SHA-1 | `5B:54:EE:B2:40:81:7D:7D:7B:F3:74:B2:D6:00:85:A4:4F:47:81:1A` |
| SHA-256 | `EF:AC:9F:83:6C:E0:EC:20:E4:FA:A8:A1:2E:06:41:89:0C:A8:DD:44:72:B5:92:6D:07:D8:97:73:47:FC:79:06` |

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
apksigner verify --print-certs dist/EcommerceDelivery-<version>.apk
```

Debe mostrar `CN=ecommerce-jcti` y el SHA-256 de la tabla.

## Google Play

Al registrar la app, sube el AAB (`./gradlew bundleRelease`) y declara esta
huella SHA-256 en Play Console. Si usas Play App Signing, Google administra la
clave de distribución; conserva igualmente este keystore para la clave de carga
(upload key).
