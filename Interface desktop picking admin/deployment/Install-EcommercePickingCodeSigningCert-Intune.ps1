# Instala el certificado de code signing de Ecommerce en los almacenes
# LocalMachine\Root y LocalMachine\TrustedPublisher.
#
# Generado por scripts/build-intune-cert-script.cjs. No editar a mano:
# regeneralo con "npm run cert:intune" si rotas el certificado.
#
# Intune: Devices > Scripts and remediations > Platform scripts > Add.
#   Run this script using the logged on credentials: No (SYSTEM)
#   Enforce script signature check: No
#   Run script in 64-bit PowerShell: Yes

$ErrorActionPreference = 'Stop'
$temp = $null

try {
    $base64 = @'
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
kyXE+GTiuByJAwgKOOXiOpIi5Lri
'@

    $bytes = [Convert]::FromBase64String(($base64 -replace '\s', ''))
    $temp = Join-Path $env:TEMP 'Ecommerce-JCTI-Picking-CodeSigning.cer'
    [IO.File]::WriteAllBytes($temp, $bytes)

    $cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new($temp)

    foreach ($storeName in @('Root', 'TrustedPublisher')) {
        $store = [Security.Cryptography.X509Certificates.X509Store]::new(
            $storeName,
            [Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
        )
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        try {
            $found = $store.Certificates.Find(
                [Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
                $cert.Thumbprint,
                $false
            )
            if ($found.Count -eq 0) {
                $store.Add($cert)
                Write-Host "Certificado instalado en LocalMachine\$storeName"
            } else {
                Write-Host "Certificado ya presente en LocalMachine\$storeName"
            }
        } finally {
            $store.Close()
        }
    }

    Write-Host "Thumbprint: $($cert.Thumbprint)"
} catch {
    Write-Error "No se pudo instalar el certificado de Ecommerce: $_"
    exit 1
} finally {
    if ($temp -and (Test-Path $temp)) {
        Remove-Item -Path $temp -Force -ErrorAction SilentlyContinue
    }
}

exit 0
