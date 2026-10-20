$ErrorActionPreference = 'Continue'
$repo   = 'C:\Users\Desarrolo4\Documents\ecommerce'
$deploy = 'C:\Users\Desarrolo4\.ssh\id_ed25519_deploy'
$known  = Join-Path $repo '.git\known_hosts_mercaldas'
$sshExe = (Get-Command ssh.exe).Source
Write-Output "ssh=$sshExe"

Get-Process ssh, git -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$fso = New-Object -ComObject Scripting.FileSystemObject
$sshUnix = $fso.GetFile($sshExe).ShortPath -replace '\\','/'
$knownUnix = $known -replace '\\','/'
$cmd = "$sshUnix -i C:/Users/Desarrolo4/.ssh/id_ed25519_deploy -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=$knownUnix"
Write-Output "sshShort=$sshUnix"
git -C $repo config --unset-all core.sshCommand 2>$null
git -C $repo config core.sshCommand $cmd
Write-Output "core.sshCommand=$cmd"

$out = Join-Path $env:TEMP 'lsremote.out'
$err = Join-Path $env:TEMP 'lsremote.err'
Remove-Item $out, $err -Force -ErrorAction SilentlyContinue

$p = Start-Process -FilePath 'git' -ArgumentList '-C', $repo, 'ls-remote', 'origin' `
  -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -NoNewWindow
if (-not $p.WaitForExit(30000)) {
  $p.Kill()
  Write-Output 'TIMEOUT ls-remote'
} else {
  Write-Output "exit=$($p.ExitCode)"
  Get-Content $out -ErrorAction SilentlyContinue | Select-Object -First 6
  Get-Content $err -ErrorAction SilentlyContinue | Select-Object -First 6
}
