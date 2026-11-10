# Activador de desarrollo del ecommerce.
# Solo localhost: no publica dominios, no usa TLS ni el edge compartido.
# Reutiliza `dev.js`, que instala dependencias, compila y levanta PostgreSQL.
#
# Uso (desde Activar-Desarrollo.bat o directamente):
#   Activar-Desarrollo.bat                        arranca la tienda y los tres paneles
#   Activar-Desarrollo.bat -Check                 solo diagnostico, no arranca nada
#   Activar-Desarrollo.bat -Apps client,admin     elige aplicativos
#   Activar-Desarrollo.bat -Stop                  detiene los servicios iniciados
#   Activar-Desarrollo.bat -Init                  fuerza instalar/compilar de nuevo
#   Activar-Desarrollo.bat -Prod                  sirve compilados (requiere -Init)
[CmdletBinding()]
param(
    [string]$Apps = 'client,admin,picking-admin,delivery-admin',
    [ValidateRange(30, 1800)][int]$TimeoutSeconds = 300,
    [switch]$Check,
    [switch]$Init,
    [switch]$Prod,
    [switch]$Stop
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    $env:PSModulePath = "$PSHOME\Modules;$env:ProgramFiles\WindowsPowerShell\Modules;$env:PSModulePath"
}
$root = Split-Path $PSScriptRoot -Parent
$devJs = Join-Path $root 'dev.js'
$logs = Join-Path $root 'logs'
$started = $false

# Aplicativo -> puertos que publica en este equipo.
$AppPorts = [ordered]@{
    client           = @(4173)
    webclient        = @(4173)
    backend          = @(3000)
    admin            = @(8443)
    'picking-admin'  = @(8446)
    'delivery-admin' = @(8447)
    bot              = @(8000)
    delivery         = @(8081)
    'picking-mobile' = @(8082)
    osrm             = @(5000)
}
$AppLabel = @{
    client           = 'Tienda (web client)'
    webclient        = 'Tienda (web client)'
    backend          = 'API (NestJS)'
    admin            = 'Panel admin'
    'picking-admin'  = 'Picking admin'
    'delivery-admin' = 'Delivery admin'
    bot              = 'Bot'
    delivery         = 'Delivery'
    'picking-mobile' = 'Picking movil'
    osrm             = 'OSRM (rutas)'
}

function Test-Tcp([string]$Machine, [int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($Machine, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(400)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch { return $false } finally { $client.Close() }
}

function Wait-Port([int]$Port, [string]$What) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Tcp '127.0.0.1' $Port) {
            Write-Host ("  [ok] {0} -> puerto {1}" -f $What, $Port)
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw ("'{0}' no respondio en el puerto {1}. Revise {2}" -f $What, $Port, $logs)
}

# PowerShell 5.1 convierte stderr nativo en error: un sondeo fallido no debe
# abortar el arranque.
function Test-DockerEngine([string]$Cli) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $null = & $Cli info 2>$null
        return ($LASTEXITCODE -eq 0)
    } finally { $ErrorActionPreference = $previous }
}

function Resolve-Node {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    $fallback = if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'nodejs\node.exe' } else { $null }
    $node = if ($command) { $command.Source } else { $fallback }
    if (-not $node -or -not (Test-Path -LiteralPath $node)) {
        throw 'Instale Node.js LTS x64 (22.12 o superior) y vuelva a ejecutar.'
    }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $version = (& $node -p 'process.versions.node' 2>$null) } finally { $ErrorActionPreference = $previous }
    if ($LASTEXITCODE -ne 0 -or -not $version) { throw 'No fue posible ejecutar Node.js.' }
    $version = "$version".Trim()
    if ([version]$version -lt [version]'22.12.0') {
        throw "Se requiere Node.js 22.12 o superior (instalado: $version)."
    }
    return @{ Path = $node; Version = $version }
}

function Resolve-Docker {
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($command) {
        $cli = $command.Source
    } elseif (Test-Path 'C:\DockerCLI\docker.exe') {
        $cli = 'C:\DockerCLI\docker.exe'
    } else {
        return @{ Ok = $false; Path = $null }
    }
    $directory = Split-Path $cli -Parent
    if (($env:PATH -split ';') -notcontains $directory) { $env:PATH = "$directory;$env:PATH" }
    $ok = Test-DockerEngine $cli
    if (-not $ok -and -not $env:DOCKER_HOST) {
        # En el VPS el motor vive dentro de WSL y expone la API solo en loopback.
        $env:DOCKER_HOST = 'tcp://127.0.0.1:2375'
        $ok = Test-DockerEngine $cli
        if (-not $ok) { Remove-Item Env:DOCKER_HOST -ErrorAction SilentlyContinue }
    }
    return @{ Ok = $ok; Path = $cli }
}

function Get-SelectedApps {
    $list = @()
    foreach ($item in ($Apps -split '[,; ]+')) {
        $name = $item.Trim().ToLowerInvariant()
        if (-not $name) { continue }
        if (-not $AppPorts.Contains($name)) {
            throw "Aplicativo desconocido: '$name'. Use: $($AppPorts.Keys -join ', ')."
        }
        if ($list -notcontains $name) { $list += $name }
    }
    if (-not $list) { throw 'Indique al menos un aplicativo en -Apps.' }
    return $list
}

try {
    if (-not (Test-Path -LiteralPath $devJs)) {
        throw 'Debe copiar el proyecto completo: dev.js junto a esta carpeta deployment.'
    }
    $nodeInfo = Resolve-Node
    $node = $nodeInfo.Path
    $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    $selected = Get-SelectedApps
    $docker = Resolve-Docker

    $distOk = Test-Path (Join-Path $root 'Interface web client\dist\index.html')
    $depsOk = (Test-Path (Join-Path $root 'backend\node_modules')) -and (Test-Path (Join-Path $root 'Interface web admin\node_modules'))

    if ($Stop) {
        Push-Location $root
        try { & $node $devJs --stop; $null = $LASTEXITCODE } finally { Pop-Location }
        Write-Host 'Servicios detenidos.'
        Write-Host 'PostgreSQL (docker) sigue corriendo. Para detenerlo: cd db\docker && docker compose stop'
        exit 0
    }

    if ($Check) {
        Write-Host "Proyecto   : $root"
        Write-Host "Node       : $($nodeInfo.Version)"
        Write-Host "pnpm       : $(if ($pnpm) { $pnpm.Source } else { 'no instalado (dev.js usara npm)' })"
        Write-Host "Docker     : $(if ($docker.Ok) { "$($docker.Path) $env:DOCKER_HOST" } else { 'NO disponible' })"
        Write-Host "Dependencias instaladas : $depsOk"
        Write-Host "Tienda compilada (dist) : $distOk"
        Write-Host 'Aplicativos y puertos:'
        foreach ($app in $selected) {
            foreach ($port in $AppPorts[$app]) {
                $state = if (Test-Tcp '127.0.0.1' $port) { 'ocupado' } else { 'libre' }
                Write-Host ("  {0,-16} {1,5}  {2}" -f $app, $port, $state)
            }
        }
        Write-Host 'Diagnostico finalizado; no se instalo nada ni se iniciaron procesos.'
        exit 0
    }

    if (-not $docker.Ok) {
        throw 'Docker no responde. Arranque el motor (en el VPS: wsl -d Ubuntu -u root -- systemctl start docker) y reintente.'
    }
    if ($Prod -and -not $distOk) {
        throw 'El modo -Prod sirve compilados: ejecute antes este activador con -Init.'
    }

    $init = $Init -or -not $depsOk -or -not $distOk
    $devArgs = @($devJs)
    if ($init) { $devArgs += '--init' }
    $devArgs += '--no-advantage'
    if ($Prod) { $devArgs += '--prod' }
    foreach ($app in $selected) { $devArgs += "--$app" }

    if ($init) {
        Write-Host 'Primer arranque: instalando dependencias, compilando la tienda y preparando PostgreSQL.'
        Write-Host '(La primera vez requiere Internet y puede tardar varios minutos.)'
    }
    Push-Location $root
    try {
        & $node @devArgs
        $code = $LASTEXITCODE
    } finally { Pop-Location }
    if ($code -ne 0) { throw "dev.js termino con codigo $code. Revise los registros en $logs" }
    $started = $true

    Write-Host ''
    Write-Host 'Esperando servicios...'
    foreach ($app in $selected) {
        foreach ($port in $AppPorts[$app]) {
            Wait-Port $port $AppLabel[$app]
        }
    }

    Write-Host ''
    Write-Host 'DESARROLLO ACTIVO (solo en este equipo)'
    foreach ($app in $selected) {
        foreach ($port in $AppPorts[$app]) {
            Write-Host ("  {0,-24} http://localhost:{1}" -f $AppLabel[$app], $port)
        }
    }
    Write-Host "  Registros                $logs"
    Write-Host ''
    Write-Host 'Mantenga esta ventana abierta. Pulse Q para detener los servicios.'
    Write-Host 'PostgreSQL (docker) no se detiene con Q; use -Stop y luego "docker compose stop" en db\docker.'

    $interactive = $true
    try { $null = [Console]::KeyAvailable } catch { $interactive = $false }
    $warned = $false
    while ($true) {
        $alive = 0
        foreach ($app in $selected) {
            foreach ($port in $AppPorts[$app]) {
                if (Test-Tcp '127.0.0.1' $port) { $alive++ }
            }
        }
        if ($alive -eq 0 -and -not $warned) {
            Write-Host "Ningun servicio responde. Revise $logs" -ForegroundColor Yellow
            $warned = $true
        }
        if ($interactive -and [Console]::KeyAvailable) {
            if ([Console]::ReadKey($true).Key -eq 'Q') { break }
        }
        Start-Sleep -Milliseconds 700
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($started) {
        Push-Location $root
        try { & $node $devJs --stop; $null = $LASTEXITCODE } finally { Pop-Location }
        Write-Host 'Servicios detenidos.'
    }
}
