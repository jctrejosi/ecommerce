#!/usr/bin/env bash
#
# Compila el APK de release de la app de Picking, firmado con ecommerce-jcti.
#
# Por qué un script: el sistema tiene Java 25 por defecto y Gradle lo rechaza
# ("Toolchain installation ... does not provide the required capabilities").
# Aquí se fuerza un JDK 17, que es el que funciona.
#
# Uso:
#   ./build-apk.sh              # compila
#   ./build-apk.sh --install    # compila e instala en el dispositivo por USB
#
# Para sobrescribir las rutas:
#   JAVA_HOME=/ruta/al/jdk ./build-apk.sh
set -euo pipefail

cd "$(dirname "$0")"

export JAVA_HOME="${JAVA_HOME:-/home/jk/jdks/jdk-17.0.20.1+1}"
export ANDROID_HOME="${ANDROID_HOME:-/home/jk/Android/Sdk}"

if [ ! -x "$JAVA_HOME/bin/javac" ]; then
  echo "ERROR: JAVA_HOME ($JAVA_HOME) no tiene un JDK válido (falta bin/javac)." >&2
  exit 1
fi

if [ ! -f signing/ecommerce-signing.properties ]; then
  echo "ERROR: falta signing/ecommerce-signing.properties (credenciales de firma)." >&2
  echo "Consulta signing/README.md." >&2
  exit 1
fi

# android/ lo regenera Expo: asegura la configuración de firma antes de compilar.
node scripts/apply-release-signing.cjs

echo "JDK:      $JAVA_HOME"
echo "SDK:      $ANDROID_HOME"
echo

cd android
./gradlew assembleRelease

APK="app/build/outputs/apk/release/app-release.apk"
APKSIGNER="$(ls "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)"
echo
"$APKSIGNER" verify --print-certs "$APK" | grep -E "Signer #1 certificate (DN|SHA-256) digest" || true

VERSION="$(node -p "require('../app.json').expo.version")"
mkdir -p ../dist
cp "$APK" "../dist/EcommercePicking-$VERSION.apk"
echo
echo "APK listo: android/$APK  ($(du -h "$APK" | cut -f1))"
echo "Copia:    dist/EcommercePicking-$VERSION.apk"

if [ "${1:-}" = "--install" ]; then
  ADB="$ANDROID_HOME/platform-tools/adb"
  echo
  echo "Instalando en el dispositivo…"
  "$ADB" install -r "$APK"
fi
