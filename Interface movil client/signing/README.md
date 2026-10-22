# Firma de release — ecommerce-jcti

La app se firma con el keystore `signing/ecommerce-jcti.jks`, alias
`ecommerce-jcti` (RSA 4096, validez 10 000 días).

| Dato | Valor |
|---|---|
| Alias | `ecommerce-jcti` |
| SHA-1 | `28:DD:ED:D8:D7:0C:46:B9:06:0E:6D:A3:F5:BC:87:B8:98:A0:31:51` |
| SHA-256 | `63:91:4D:88:5F:6B:DF:0F:34:F7:75:05:D8:8D:48:1E:4C:5F:82:2C:9E:F6:50:09:0D:8B:6F:2C:D1:68:F4:23` |

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
apksigner verify --print-certs dist/EcommerceClient-<version>.apk
```

Debe mostrar `CN=ecommerce-jcti` y el SHA-256 de la tabla.

## Google Play

Al registrar la app, sube el AAB (`./gradlew bundleRelease`) y declara esta
huella SHA-256 en Play Console. Si usas Play App Signing, Google administra la
clave de distribución; conserva igualmente este keystore para la clave de carga
(upload key).
