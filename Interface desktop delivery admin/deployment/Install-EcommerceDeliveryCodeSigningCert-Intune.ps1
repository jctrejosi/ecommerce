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
CAZf/7wTCE2jn3vgJCOZwskV5gdLnXc=
'@

    $bytes = [Convert]::FromBase64String(($base64 -replace '\s', ''))
    $temp = Join-Path $env:TEMP 'Ecommerce-JCTI-Delivery-CodeSigning.cer'
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
