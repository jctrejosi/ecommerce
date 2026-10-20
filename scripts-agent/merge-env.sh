#!/bin/bash
# Rellena en el .env destino solo las claves vacías, tomando valores del origen.
# No imprime valores: solo FILLED/SKIP.
set -euo pipefail
src="${1:?uso: merge-env.sh <origen> <destino>}"
dst="${2:?uso: merge-env.sh <origen> <destino>}"
keys="CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET WOMPI_PUBLIC_KEY WOMPI_PRIVATE_KEY WOMPI_INTEGRITY_KEY EPAYCO_PUBLIC_KEY EPAYCO_PRIVATE_KEY QR_ANALYZER_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET FIREBASE_SERVICE_ACCOUNT_JSON RESEND_API_KEY DEEPSEEK_API_KEY DEEPSEEK_API_URL DEEPSEEK_TIMEOUT"

cp "$dst" "$dst.bak-$(date +%Y%m%d-%H%M%S)"

for k in $keys; do
  srcval=$(grep -m1 "^${k}=" "$src" | cut -d= -f2- | tr -d '\r' || true)
  dstval=$(grep -m1 "^${k}=" "$dst" | cut -d= -f2- | tr -d '\r' || true)
  if [ -n "${srcval:-}" ] && [ -z "${dstval:-}" ]; then
    python3 - "$dst" "$k" "$srcval" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); k = sys.argv[2]; v = sys.argv[3]
lines = p.read_text().splitlines()
replaced = False
for i, l in enumerate(lines):
    if l.startswith(k + '='):
        lines[i] = k + '=' + v
        replaced = True
        break
if not replaced:
    lines.append(k + '=' + v)
p.write_text('\n'.join(lines) + '\n')
PY
    echo "$k=FILLED"
  else
    echo "$k=SKIP"
  fi
done
