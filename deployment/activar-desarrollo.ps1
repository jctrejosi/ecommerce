# Activador de desarrollo del ecommerce.
# Solo localhost: no publica dominios, no usa TLS ni el edge compartido.
# Reutiliza `dev.js`, que instala dependencias, compila y levanta PostgreSQL.
# Si Docker Desktop esta detenido, lo inicia y espera al motor (180 s por defecto).
#
# Uso (desde Activar-Desarrollo.bat o directamente):
#   Activar-Desarrollo.bat                        arranca la tienda y los tres paneles
#   Activar-Desarrollo.bat -Check                 solo diagnostico, no arranca nada
#   Activar-Desarrollo.bat -Apps client,admin     elige aplicativos
#   Activar-Desarrollo.bat -Stop                  detiene los servicios iniciados
#   Activar-Desarrollo.bat -Init                  fuerza instalar/compilar de nuevo
#   Activar-Desarrollo.bat -Prod                  sirve compilados (requiere -Init)
#   Activar-Desarrollo.bat -NoPersist             no guarda PATH/DOCKER_HOST del usuario
#   Activar-Desarrollo.bat -DockerDesktopPath "C:\ruta\Docker Desktop.exe"  ruta manual
[CmdletBinding()]
param(
    [string]$Apps = 'client,admin,picking-admin,delivery-admin',
    [ValidateRange(30, 1800)][int]$TimeoutSeconds = 300,
    [ValidateRange(30, 900)][int]$DockerTimeoutSeconds = 180,
    [string]$DockerDesktopPath = '',
    [switch]$NoPersist,
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

function Find-DockerDesktop([string]$Explicit) {
    if ($Explicit) {
        if (Test-Path -LiteralPath $Explicit) { return $Explicit }
        return $null
    }
    $candidates = @(
        'C:\Program Files\Docker\Docker\Docker Desktop.exe',
        'C:\Program Files\Docker\Docker Desktop.exe',
        'C:\Program Files (x86)\Docker\Docker\Docker Desktop.exe'
    )
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe')
        $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker Desktop.exe')
    }
    $hit = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($hit) { return $hit }

    # Si ya esta corriendo, su ruta es la respuesta.
    $process = Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($process) {
        try { if ($process.Path) { return $process.Path } } catch { }
    }

    # Instalacion en ruta no estandar: lo que declare el desinstalador.
    $keys = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    $entry = Get-ItemProperty $keys -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like 'Docker Desktop*' -and $_.InstallLocation } |
        Select-Object -First 1
    if ($entry) {
        $candidate = Join-Path $entry.InstallLocation 'Docker Desktop.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }

    foreach ($root in @('C:\Program Files\Docker', 'C:\Program Files (x86)\Docker')) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $found = Get-ChildItem -LiteralPath $root -Filter 'Docker Desktop.exe' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Resolve-Docker {
    param(
        [switch]$StartIfNeeded = $true,
        [int]$TimeoutSeconds = 180
    )
    # Docker Desktop instala su CLI en resources\bin; C:\DockerCLI es la
    # instalacion previa del servidor (motor WSL sin Desktop).
    $candidates = @(
        'C:\Program Files\Docker\Docker\resources\bin\docker.exe',
        'C:\DockerCLI\docker.exe'
    )
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Docker\Docker\resources\bin\docker.exe') }
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates = @($command.Source) + $candidates }
    $cli = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $cli) {
        return @{ Ok = $false; Path = $null; Detail = 'no se encontro docker.exe (instale Docker Desktop)' }
    }
    $directory = Split-Path $cli -Parent
    if (($env:PATH -split ';') -notcontains $directory) { $env:PATH = "$directory;$env:PATH" }

    if (Test-DockerEngine $cli) { return @{ Ok = $true; Path = $cli; Detail = 'motor en marcha' } }

    # Motor WSL antiguo, expuesto solo en loopback (no necesita Docker Desktop).
    if (Test-Tcp '127.0.0.1' 2375) {
        $env:DOCKER_HOST = 'tcp://127.0.0.1:2375'
        if (Test-DockerEngine $cli) {
            return @{ Ok = $true; Path = $cli; Detail = 'motor WSL en 127.0.0.1:2375' }
        }
        Remove-Item Env:DOCKER_HOST -ErrorAction SilentlyContinue
    }
    # Un DOCKER_HOST heredado que no responde impediria hablar con Docker Desktop.
    if ($env:DOCKER_HOST) { Remove-Item Env:DOCKER_HOST -ErrorAction SilentlyContinue }

    $desktop = Find-DockerDesktop $DockerDesktopPath
    if (-not $desktop) {
        # Puede estar instalado por-usuario en el perfil de otra cuenta.
        $elsewhere = $null
        foreach ($profile in (Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue)) {
            $candidate = Join-Path $profile.FullName 'AppData\Local\Docker\Docker Desktop.exe'
            if (Test-Path -LiteralPath $candidate) { $elsewhere = $candidate; break }
        }
        if ($elsewhere) {
            return @{ Ok = $false; Path = $cli; Detail = "Docker Desktop esta instalado en el perfil de otra cuenta: $elsewhere. Ejecute el lanzador con esa cuenta, instalele Docker Desktop a esta, o pase -DockerDesktopPath" }
        }
        return @{ Ok = $false; Path = $cli; Detail = 'motor apagado y no se encontro Docker Desktop (se reviso Program Files, LOCALAPPDATA y el registro); indique la ruta con -DockerDesktopPath' }
    }
    if (-not $StartIfNeeded) {
        return @{ Ok = $false; Path = $cli; Detail = 'Docker Desktop esta detenido' }
    }

    if (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue) {
        Write-Host 'Docker Desktop esta iniciando: esperando al motor...'
    } else {
        Write-Host 'Docker Desktop esta detenido: iniciandolo (la primera vez puede tardar un minuto)...'
        Start-Process -FilePath $desktop | Out-Null
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-DockerEngine $cli) {
            return @{ Ok = $true; Path = $cli; Detail = 'Docker Desktop iniciado' }
        }
        Start-Sleep -Seconds 3
    }
    return @{ Ok = $false; Path = $cli; Detail = "Docker Desktop no respondio en $TimeoutSeconds s; revise la bandeja del sistema (licencia, login o aviso de WSL)" }
}

function Save-DockerEnvironment([string]$Cli) {
    # Solo se guarda lo que hace falta para que `node dev.js` funcione en una
    # ventana nueva: la carpeta del CLI y, si aplica, la API del motor WSL.
    $changes = @()
    try {
        $directory = Split-Path $Cli -Parent
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $entries = @()
        if ($userPath) { $entries = @($userPath -split ';' | Where-Object { $_ }) }
        if ($entries -notcontains $directory) {
            [Environment]::SetEnvironmentVariable('Path', (($entries + $directory) -join ';'), 'User')
            $changes += "PATH del usuario += $directory"
        }

        if ($env:DOCKER_HOST -eq 'tcp://127.0.0.1:2375') {
            if ([Environment]::GetEnvironmentVariable('DOCKER_HOST', 'User') -ne $env:DOCKER_HOST) {
                [Environment]::SetEnvironmentVariable('DOCKER_HOST', $env:DOCKER_HOST, 'User')
                $changes += "DOCKER_HOST = $env:DOCKER_HOST"
            }
        } elseif ([Environment]::GetEnvironmentVariable('DOCKER_HOST', 'User') -eq 'tcp://127.0.0.1:2375') {
            # Motor local (Docker Desktop): el DOCKER_HOST viejo solo estorba.
            [Environment]::SetEnvironmentVariable('DOCKER_HOST', $null, 'User')
            $changes += 'DOCKER_HOST del usuario eliminado (apuntaba al motor WSL viejo)'
        }
    } catch {
        Write-Host "Aviso: no se pudo guardar la configuracion de Docker para el usuario: $($_.Exception.Message)" -ForegroundColor Yellow
        return
    }
    if ($changes.Count) {
        Write-Host 'Docker configurado para este usuario (aplica a ventanas nuevas):'
        foreach ($change in $changes) { Write-Host "  $change" }
    } else {
        Write-Host 'Docker ya estaba configurado para este usuario.'
    }
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
    $docker = Resolve-Docker -StartIfNeeded:(-not ($Check -or $Stop)) -TimeoutSeconds $DockerTimeoutSeconds

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
        Write-Host "Docker     : $(if ($docker.Ok) { "motor OK ($($docker.Detail))" } else { "NO disponible ($($docker.Detail))" })"
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
        throw "Docker no esta disponible: $($docker.Detail). Abra Docker Desktop, complete los avisos (licencia, WSL o login) y ejecute de nuevo este lanzador."
    }
    if (-not $NoPersist) { Save-DockerEnvironment $docker.Path }
    if ($Prod -and -not $distOk) {
        throw 'El modo -Prod sirve compilados: ejecute antes este activador con -Init.'
    }

    $init = $Init -or -not $depsOk -or -not $distOk
    # Motor nuevo (p. ej. Docker Desktop recien instalado): aun no existe la BD,
    # asi que hay que crearla y montar el respaldo versionado.
    $freshDb = $false
    if ($docker.Ok) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $names = & $docker.Path ps -a --filter 'name=ecommerce_postgres' --format '{{.Names}}' 2>$null
        } finally { $ErrorActionPreference = $previous }
        $freshDb = -not (@($names) -contains 'ecommerce_postgres')
        if ($freshDb) {
            $init = $true
            Write-Host 'Motor Docker sin la base de datos del ecommerce: se crea y se restaura el respaldo.'
        }
    }
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
