# Restaura el respaldo de db/backups/ecommerce en el PostgreSQL del proyecto (Windows).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\db\backups\ecommerce\restore.ps1
#   $env:DB_CONTAINER="otro"; $env:DB_NAME="otra"; .\db\backups\ecommerce\restore.ps1
#
# Reensambla las partes, comprueba el sha256 del volcado completo y restaura.
# Al final verifica conteos: si algo salió mal, lo dice (no falla en silencio).
$ErrorActionPreference = "Stop"

$container = if ($env:DB_CONTAINER) { $env:DB_CONTAINER } else { "ecommerce_postgres" }
$db        = if ($env:DB_NAME) { $env:DB_NAME } else { "ecommerce" }
$dir       = Split-Path -Parent $MyInvocation.MyCommand.Path
$tmp       = Join-Path $dir "ecommerce_restore.dump"
$ctmp      = "/tmp/ecommerce_restore.dump"

# ── 1. Reensamblar ─────────────────────────────────────────────
$single = Join-Path $dir "ecommerce.dump"
if (Test-Path $single) {
  Write-Host "-> Usando el volcado completo ecommerce.dump"
  Copy-Item $single $tmp -Force
} else {
  Write-Host "-> Reensamblando partes (part-*)..."
  $parts = Get-ChildItem (Join-Path $dir "ecommerce.dump.part-*") | Sort-Object Name
  if ($parts.Count -eq 0) { throw "No hay partes en $dir" }
  $out = [System.IO.File]::Create($tmp)
  try {
    foreach ($p in $parts) {
      $bytes = [System.IO.File]::ReadAllBytes($p.FullName)
      $out.Write($bytes, 0, $bytes.Length)
    }
  } finally { $out.Close() }
}

# ── 2. Verificar integridad (clave en otro PC) ─────────────────
$shaFile = Join-Path $dir "ecommerce.dump.sha256"
if (Test-Path $shaFile) {
  $expected = (Get-Content $shaFile -Raw).Trim().ToLower()
  $actual = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) {
    Remove-Item $tmp -Force
    throw "El respaldo NO coincide con su sha256.`n  esperado: $expected`n  obtenido: $actual`n  Suele ser por partes faltantes o descargadas a medias: vuelve a copiar db/backups/ecommerce/ completo."
  }
  Write-Host "OK sha256"
}

# ── 3. Copiar al contenedor y restaurar ────────────────────────
Write-Host "-> Copiando al contenedor $container..."
docker cp $tmp "${container}:${ctmp}"
Remove-Item $tmp -Force

Write-Host "-> Restaurando en la BD $db (pg_restore)..."
docker exec $container pg_restore -U postgres -d $db --clean --if-exists --no-owner --no-privileges $ctmp
$rc = $LASTEXITCODE
docker exec $container rm -f $ctmp
Write-Host "  pg_restore exit=$rc (los avisos benignos no impiden la restauracion)"

# ── 4. Verificación (no fallar en silencio) ────────────────────
Write-Host "-> Verificando conteos..."
docker exec $container psql -U postgres -d $db -tAc "SELECT 'branches=' || count(*) FROM branches UNION ALL SELECT 'products=' || count(*) FROM products UNION ALL SELECT 'prices=' || count(*) FROM prices UNION ALL SELECT 'inventory=' || count(*) FROM inventory UNION ALL SELECT 'orders=' || count(*) FROM orders"

Write-Host "Restauracion terminada."
