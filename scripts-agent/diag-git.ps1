$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\Desarrolo4\Documents\ecommerce'
$sshShort = 'C:/PROGRA~1/OpenSSH/ssh.exe'
$out = Join-Path $env:TEMP 'sshgit.out'
$err = Join-Path $env:TEMP 'sshgit.err'
Remove-Item $out, $err -Force -ErrorAction SilentlyContinue

Write-Output '--- env GIT ---'
Get-ChildItem Env:GIT* -ErrorAction SilentlyContinue | Format-Table -AutoSize

$args = @(
  '-i', 'C:/Users/Desarrolo4/.ssh/id_ed25519_deploy',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=C:/Users/Desarrolo4/Documents/ecommerce/.git/known_hosts_mercaldas',
  '-vvv',
  'git@github.com',
  "git-upload-pack 'jctrejosi/ecommerce.git'"
)

$p = Start-Process -FilePath $sshShort -ArgumentList $args `
  -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -NoNewWindow
if (-not $p.WaitForExit(25000)) {
  $p.Kill()
  Write-Output 'TIMEOUT ssh git-upload-pack'
} else {
  Write-Output "exit=$($p.ExitCode)"
}
Write-Output '--- stderr (tail) ---'
Get-Content $err -ErrorAction SilentlyContinue | Select-Object -Last 25
