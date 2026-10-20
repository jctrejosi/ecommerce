$ErrorActionPreference = 'SilentlyContinue'
$ports = 8501, 19955, 6262, 5002
$pids = Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in $ports } |
  Select-Object -ExpandProperty OwningProcess -Unique

$out = @(
  foreach ($id in $pids) {
    $pr = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
    $svc = Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -eq $id }
    [pscustomobject]@{
      PID     = $id
      Name    = $pr.Name
      Service = $svc.Name
      Display = $svc.DisplayName
      Cmd     = $pr.CommandLine
    }
  }
)
$out | Format-List
