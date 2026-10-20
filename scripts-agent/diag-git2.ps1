$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\Desarrolo4\Documents\ecommerce'
$env:GIT_TRACE = '1'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

Write-Output '--- core.sshCommand (todos) ---'
git -C $repo config --get-all core.sshCommand
Write-Output '--- remotes ---'
git -C $repo remote -v

Write-Output '--- ls-remote con trace ---'
& git -C $repo ls-remote origin 2>&1 | Select-Object -First 50
Write-Output "exit=$LASTEXITCODE"
