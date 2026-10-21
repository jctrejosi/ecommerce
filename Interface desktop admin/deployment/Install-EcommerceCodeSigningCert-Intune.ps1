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
MIIFtzCCA5+gAwIBAgIUOcP52qvS1GCOia76oV7dh+XbS1IwDQYJKoZIhvcNAQELBQAwVzELMAkG
A1UEBhMCQ08xEjAQBgNVBAoMCUVjb21tZXJjZTETMBEGA1UECwwKVGVjbm9sb2dpYTEfMB0GA1UE
AwwWRWNvbW1lcmNlIENvZGUgU2lnbmluZzAeFw0yNjEwMjExNjQ4MTRaFw0zNjEwMTgxNjQ4MTRa
MFcxCzAJBgNVBAYTAkNPMRIwEAYDVQQKDAlFY29tbWVyY2UxEzARBgNVBAsMClRlY25vbG9naWEx
HzAdBgNVBAMMFkVjb21tZXJjZSBDb2RlIFNpZ25pbmcwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAw
ggIKAoICAQDoIwA6GX828Q96WYx4E0kGDnYv16aDho8u+x6zIZmKzBns1w4vYIPWzy2NKr30FIp3
lCqTjTIyWEzxWG4F2FE5FfU4MHLM3N+wEfzaKoFclaPRpdbuVp6+llgw1X7O345C/akRb4AxhzFf
T4pqczYKLKrKTS+Vgz2LKZ95/PMrkJtTYoyZO68ayZEME1aBheq4/vvtBUW/cGBl4a1CnzkAyTQX
6cbcsa87CMoTI+WrkE9f8i+f2V0+ng5hRldHg/KDGY7nXX7J6/QhjdXKeW3jr1a6dLYgibhpNIA4
+3nDd7ogb85UaL+3w/AdcIp++pObr3szcqihZSTWTLy6ptonxQaogZLz87bs9jvQWikYxhsVButC
VDC5XFDXkXGxAc7/eyp/gPROrfhuoDxxxs8mRta1uVzbfe8m6YyxJZIMPdPEH8Vdeu/q1jsze9I4
APNmcStMfPxuZ4vgGrvSLCFQQPRPA0AL7B1Q+Q8wQy4+Xm7lSXsidudkntT4LvgTNfe6TISvVpZY
AO8o0xmBJeU2I9KeocKM1SxgqDNMzLeea8Kx0W3oCpTjagRo94PUSKjnW7dph3EIK8CV2PgGrQqc
fh0WucPPQrDHN8uywt9JVNas+KfELOWDSRnnOuVj002VNXUSdF7o0wKZDF9pKYTkWoispkO48NGl
GH5IwtmbAQIDAQABo3sweTAfBgNVHSMEGDAWgBTc44WMxChNsUuv7nsprh2HI9nIizAPBgNVHRMB
Af8EBTADAQH/MA4GA1UdDwEB/wQEAwIChDAWBgNVHSUBAf8EDDAKBggrBgEFBQcDAzAdBgNVHQ4E
FgQU3OOFjMQoTbFLr+57Ka4dhyPZyIswDQYJKoZIhvcNAQELBQADggIBAF3h9OxL8LbWdaVuLrB6
MMOoA3vxDmtQP+n4Gvgw55xenWL9KY06fXW5cIPdMhzowtvpJnMbNQc4/srLy1iLFO9wW3ZXbzQc
12WHRU/wgvtf9C7ik8nsvbMgbc9IQ96eFhcRHCUeaU66Zlz8wUGg+78U0Tui4b/yHCSq9f5UYEcj
IimkUqBHHYH7gpCBqkmK9tzhpeU6+/1E1di580H0RGHoCHLi7HEWn1XanXGerJki9fIKXJnf7dj6
qGxTnokzhOkj0UKglrSONE6h78otB/Tp9M9ZZLiCCfGQfVliMMRYpONEJVtxJh0KUPV/3D9Gi0uU
/nVPeiWmP50KeDIVhJYwAnDqfHPtk+HTSqb00R1ZWHOB5qXc+blVJDZ6QGzwvJePDJbPqi36Nlkn
/RvPsyT0AfdDBoUk3WWig9AoCeq19RsCH9vpFgZu+ktKvTuRztYQWEMxgbFOhFSEd4zF37q2bfsh
AQGlL4yT+TADWNqA532flha753W/vV7FfsC7B1Q4GsrtIdu3QGWVPfSplxgTheUcudW1x156ggXf
MM+4jLAGTBbpoiqil6EA5W1endfjYUwwptLcmQCwZCmQZgm6Uifhm22MdrJCJWGHqlunxfNciexH
zkV11irnTya1j6z+L0Egj8k8ieLOj5mHs8uJwBoQFUUl+t5gvCUHiyVt
'@

    $bytes = [Convert]::FromBase64String(($base64 -replace '\s', ''))
    $temp = Join-Path $env:TEMP 'Ecommerce-CodeSigning.cer'
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
