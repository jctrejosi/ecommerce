#!/usr/bin/env bash
#
# Compila el APK de release del cliente móvil (Mercaldas).
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

echo "JDK:      $JAVA_HOME"
echo "SDK:      $ANDROID_HOME"
echo

cd android
./gradlew assembleRelease

APK="app/build/outputs/apk/release/app-release.apk"
echo
echo "APK listo: android/$APK  ($(du -h "$APK" | cut -f1))"

if [ "${1:-}" = "--install" ]; then
  ADB="$ANDROID_HOME/platform-tools/adb"
  echo
  echo "Instalando en el dispositivo…"
  "$ADB" install -r "$APK"
fi
