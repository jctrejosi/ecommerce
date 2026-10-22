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
aMx4kNA=
'@

    $bytes = [Convert]::FromBase64String(($base64 -replace '\s', ''))
    $temp = Join-Path $env:TEMP 'Ecommerce-JCTI-CodeSigning.cer'
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
