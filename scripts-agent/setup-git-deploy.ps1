$ErrorActionPreference = 'Stop'

$sshDir = 'C:\Users\Desarrolo4\.ssh'
$src    = Join-Path $sshDir 'id_ed25519'
$deploy = Join-Path $sshDir 'id_ed25519_deploy'
$known  = Join-Path $sshDir 'known_hosts_mercaldas'

Copy-Item $src $deploy -Force
# Misma clave pública; solo quitamos la passphrase de la copia para que Git
# pueda usarla sin agente ni intervención manual.
$line = 'ssh-keygen -p -P "pan con aguapanela" -N "" -f "' + $deploy + '"'
& cmd.exe /c $line
if ($LASTEXITCODE -ne 0) { throw 'No se pudo quitar la passphrase de la copia de la clave' }
icacls $deploy /inheritance:r /grant:r "$env:USERNAME:(R)" | Out-Null

if (-not (Test-Path $known)) { New-Item -ItemType File -Path $known | Out-Null }

Set-Location 'C:\Users\Desarrolo4\Documents\ecommerce'
git config core.sshCommand "ssh -i C:/Users/Desarrolo4/.ssh/id_ed25519_deploy -o IdentitiesOnly=yes -o UserKnownHostsFile=C:/Users/Desarrolo4/.ssh/known_hosts_mercaldas -o StrictHostKeyChecking=accept-new"

Write-Output '--- prueba ssh ---'
& ssh -i $deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$known -T git@github.com 2>&1 | Select-Object -First 4
Write-Output '--- prueba repo ---'
git ls-remote origin 2>&1 | Select-Object -First 3
