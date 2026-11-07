#!/usr/bin/env node
/**
 * Inyecta la configuración de firma de release "ecommerce-jcti" en
 * android/app/build.gradle.
 *
 * La carpeta android/ la genera Expo y está ignorada por git, así que este
 * script se ejecuta antes de compilar y después de cada `expo prebuild`.
 * Las credenciales viven en signing/ecommerce-signing.properties (ignorado).
 */
const fs = require('node:fs');
const path = require('node:path');

const MARK = 'ecommerce-jcti-release-signing';
const root = path.resolve(__dirname, '..');
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');

if (!fs.existsSync(gradlePath)) {
  console.error(
    `No existe ${path.relative(root, gradlePath)}. Ejecuta "npx expo prebuild" primero.`
  );
  process.exit(1);
}

let source = fs.readFileSync(gradlePath, 'utf8');

if (source.includes(`// ${MARK}`)) {
  console.log('Firma de release ecommerce-jcti: ya aplicada.');
  process.exit(0);
}

const loader = `// ${MARK}
def ecommerceSigningProperties = new Properties()
def ecommerceSigningPropertiesFile = rootProject.file("../signing/ecommerce-signing.properties")
if (ecommerceSigningPropertiesFile.exists()) {
    ecommerceSigningProperties.load(new FileInputStream(ecommerceSigningPropertiesFile))
}
def hasEcommerceSigning = ecommerceSigningPropertiesFile.exists()
// /${MARK}

android {`;

const beforeLoader = source;
source = source.replace(/\nandroid \{/, `\n${loader}`);
if (source === beforeLoader) {
  console.error('No se encontró el bloque "android {" en build.gradle.');
  process.exit(1);
}

const releaseSigning = `        if (hasEcommerceSigning) {
            release {
                storeFile rootProject.file(ecommerceSigningProperties['storeFile'])
                storePassword ecommerceSigningProperties['storePassword']
                keyAlias ecommerceSigningProperties['keyAlias']
                keyPassword ecommerceSigningProperties['keyPassword']
            }
        }
`;
const beforeSigning = source;
source = source.replace('    signingConfigs {\n', `    signingConfigs {\n${releaseSigning}`);
if (source === beforeSigning) {
  console.error('No se encontró el bloque "signingConfigs" en build.gradle.');
  process.exit(1);
}

const debugRelease = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;
const signedRelease = `            // Firma de release: ecommerce-jcti (ver signing/README.md).
            signingConfig hasEcommerceSigning ? signingConfigs.release : signingConfigs.debug`;

if (!source.includes(debugRelease)) {
  console.error('No se encontró el bloque release de buildTypes en build.gradle.');
  process.exit(1);
}
source = source.replace(debugRelease, signedRelease);

fs.writeFileSync(gradlePath, source);
console.log('Firma de release ecommerce-jcti aplicada a android/app/build.gradle.');
