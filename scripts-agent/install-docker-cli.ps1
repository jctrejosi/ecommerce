$ErrorActionPreference = 'Stop'

$dir = 'C:\DockerCLI'
New-Item -ItemType Directory -Force $dir | Out-Null

$tmp = Join-Path $env:TEMP 'docker-cli.zip'
Invoke-WebRequest 'https://download.docker.com/win/static/stable/x86_64/docker-29.9.1.zip' -OutFile $tmp -UseBasicParsing
$ext = Join-Path $env:TEMP 'docker-cli-ext'
if (Test-Path $ext) { Remove-Item $ext -Recurse -Force }
Expand-Archive $tmp -DestinationPath $ext -Force
Copy-Item (Join-Path $ext 'docker\docker.exe') (Join-Path $dir 'docker.exe') -Force

$pluginDir = 'C:\Users\Desarrolo4\.docker-prod\cli-plugins'
New-Item -ItemType Directory -Force $pluginDir | Out-Null

Invoke-WebRequest 'https://github.com/docker/compose/releases/latest/download/docker-compose-windows-x86_64.exe' `
  -OutFile (Join-Path $pluginDir 'docker-compose.exe') -UseBasicParsing

$rel = Invoke-RestMethod 'https://api.github.com/repos/docker/buildx/releases/latest'
$asset = $rel.assets | Where-Object { $_.name -like '*windows-amd64*' } | Select-Object -First 1
if ($asset) {
  Invoke-WebRequest $asset.browser_download_url -OutFile (Join-Path $pluginDir 'docker-buildx.exe') -UseBasicParsing
}

$machinePath = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
if ($machinePath -notlike '*C:\DockerCLI*') {
  [Environment]::SetEnvironmentVariable('PATH', 'C:\DockerCLI;' + $machinePath, 'Machine')
}

$env:PATH = 'C:\DockerCLI;' + $env:PATH
$env:DOCKER_HOST = 'tcp://127.0.0.1:2375'
$env:DOCKER_CONFIG = 'C:\Users\Desarrolo4\.docker-prod'

& (Join-Path $dir 'docker.exe') version --format 'cli={{.Client.Version}} server={{.Server.Version}}'
Get-ChildItem $pluginDir | Select-Object Name, Length
