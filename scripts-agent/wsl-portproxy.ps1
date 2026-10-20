# Publica 80/443 (edge de Caddy) hacia la IP actual de la distro WSL.
# La IP de WSL cambia en cada arranque, por eso se recalcula y se reescribe
# el portproxy. Se ejecuta como tarea programada al iniciar el servidor.
$ErrorActionPreference = 'Continue'
Start-Sleep -Seconds 20

$ip = $null
for ($i = 0; $i -lt 30; $i++) {
  $out = & wsl.exe -d Ubuntu -u root -- hostname -I 2>$null
  if ($out) {
    $candidate = ($out -split '\s+')[0]
    if ($candidate -match '^\d+\.\d+\.\d+\.\d+$') {
      $ip = $candidate
      break
    }
  }
  Start-Sleep -Seconds 10
}

if (-not $ip) {
  Write-EventLog -LogName Application -Source 'Mercaldas' -EntryType Error -EventId 1001 `
    -Message 'No se pudo obtener la IP de la distro WSL Ubuntu; portproxy no configurado.' -ErrorAction SilentlyContinue
  exit 1
}

$show = (netsh interface portproxy show v4tov4) -join "`n"
$needsUpdate = $false
foreach ($p in 80, 443) {
  if ($show -notmatch "0\.0\.0\.0\s+$p\s+$([regex]::Escape($ip))\s+$p") { $needsUpdate = $true }
}

if ($needsUpdate) {
  foreach ($p in 80, 443) {
    netsh interface portproxy delete v4tov4 listenport=$p listenaddress=0.0.0.0 2>$null | Out-Null
    netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$p connectaddress=$ip connectport=$p | Out-Null
  }
}

foreach ($p in 80, 443) {
  if (-not (Get-NetFirewallRule -DisplayName "Mercaldas TCP $p" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Mercaldas TCP $p" -Direction Inbound -Protocol TCP `
      -LocalPort $p -Action Allow -Profile Any | Out-Null
  }
}

Write-Output "portproxy 80/443 -> ${ip}:80/443 OK"
