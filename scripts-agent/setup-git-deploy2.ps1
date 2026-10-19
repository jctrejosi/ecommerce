$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\Desarrolo4\Documents\ecommerce'
$fso = New-Object -ComObject Scripting.FileSystemObject
$gitSsh = $fso.GetFile('C:\Program Files\Git\usr\bin\ssh.exe').ShortPath -replace '\\','/'
$deploy = 'C:/Users/Desarrolo4/.ssh/id_ed25519_deploy'
$known = 'C:/Users/Desarrolo4/Documents/ecommerce/.git/known_hosts_mercaldas'
$opts = "-i $deploy -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=$known"
Write-Output "gitSsh=$gitSsh"

Get-Process ssh, git -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

git -C $repo config --unset-all core.sshCommand 2>$null
git -C $repo config core.sshCommand "$gitSsh $opts"
Write-Output "core.sshCommand=$(git -C $repo config --get core.sshCommand)"

Write-Output '--- ssh directo ---'
& $gitSsh -i $deploy -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=$known -T git@github.com 2>&1 | Select-Object -First 3

Write-Output '--- ls-remote ---'
$out = Join-Path $env:TEMP 'lsremote2.out'
$err = Join-Path $env:TEMP 'lsremote2.err'
Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'git' -ArgumentList '-C', $repo, 'ls-remote', 'origin' `
  -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -NoNewWindow
if (-not $p.WaitForExit(40000)) {
  $p.Kill()
  Write-Output 'TIMEOUT ls-remote'
} else {
  Write-Output 'ls-remote OK'
  Get-Content $out -ErrorAction SilentlyContinue | Select-Object -First 5
  Get-Content $err -ErrorAction SilentlyContinue | Select-Object -First 5
}
