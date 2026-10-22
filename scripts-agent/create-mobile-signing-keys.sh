#!/usr/bin/env bash
# Crea los keystores de release de las apps móviles con identidad ecommerce-jcti.
# Guarda las credenciales en <app>/signing/ecommerce-signing.properties (ignorado).
set -euo pipefail

ROOT="/home/jk/Proyectos/dsi/ecommerce"
KEYTOOL="/home/jk/jdks/jdk-17.0.20.1+1/bin/keytool"

for app in "Interface movil client" "Interface movil delivery" "Interface movil picking"; do
  dir="$ROOT/$app"
  keystore="$dir/signing/ecommerce-jcti.jks"
  props="$dir/signing/ecommerce-signing.properties"

  if [ -f "$keystore" ]; then
    echo "YA EXISTE: $app (no se toca)"
    continue
  fi

  pass="$(openssl rand -hex 24)"
  "$KEYTOOL" -genkeypair -v \
    -keystore "$keystore" \
    -alias ecommerce-jcti \
    -keyalg RSA -keysize 4096 -validity 10000 \
    -storepass "$pass" -keypass "$pass" \
    -dname "CN=ecommerce-jcti, OU=Movil, O=Ecommerce-JCTI, L=Bogota, ST=Cundinamarca, C=CO" \
    >/dev/null 2>&1

  printf '%s\n' \
    'storeFile=../signing/ecommerce-jcti.jks' \
    "storePassword=$pass" \
    'keyAlias=ecommerce-jcti' \
    "keyPassword=$pass" > "$props"

  chmod 600 "$keystore" "$props"
  echo "OK: $app"
done
