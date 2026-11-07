#!/usr/bin/env bash
# Muestra la identidad y huellas de los keystores de release (sin exponer contraseñas).
set -euo pipefail

ROOT="/home/jk/Proyectos/dsi/ecommerce"
KEYTOOL="/home/jk/jdks/jdk-17.0.20.1+1/bin/keytool"

for app in "Interface movil client" "Interface movil delivery" "Interface movil picking"; do
  dir="$ROOT/$app"
  keystore="$dir/signing/ecommerce-jcti.jks"
  props="$dir/signing/ecommerce-signing.properties"
  pass="$(sed -n 's/^storePassword=//p' "$props")"

  echo "=== $app"
  "$KEYTOOL" -list -v -keystore "$keystore" -alias ecommerce-jcti -storepass "$pass" 2>/dev/null |
    grep -E "Alias name|Owner|Valid from|SHA1:|SHA256:"
  echo
done
