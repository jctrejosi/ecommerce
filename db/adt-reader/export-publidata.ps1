# ===== Exportar Publidata (ADS) a CSV =====
# Ejecutar en PowerShell como administrador en la máquina Windows con ADS.
$ErrorActionPreference = "Stop"

# Ruta del diccionario (ajústala si el Paso 1 de detección dio otra)
$dic = "C:\VISADS_25\ADD\Publidata.add"
if (-not (Test-Path $dic)) {
  $c = Get-ChildItem C:\ -Recurse -Filter "Publidata.add" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { $dic = $c.FullName } else { throw "No encontré Publidata.add. Ajusta la ruta." }
}
Write-Host "Diccionario: $dic" -ForegroundColor Cyan

# Tablas a exportar (las de db/ADDT)
$tablas = @("VENTAS","CATALOGO2","POSCLI","P_A_100_50","P_A_102_50","SEMBODE","TEMTSOL","V25CRM","FADCLI")

# Conexión LOCAL al servidor ADS de esta misma máquina
$cs = "Driver={Advantage ODBC Driver};DataDirectory=$dic;ServerTypes=ADS_LOCAL_SERVER;TableType=ADS_CDX;UID=AdsSys;PWD=Pubdata"
# Si el servidor ADS está en OTRA máquina, usa esta línea en su lugar:
# $cs = "Driver={Advantage ODBC Driver};Server=localhost:6262;DataDirectory=$dic;TableType=ADS_CDX;UID=AdsSys;PWD=Pubdata"

$conn = New-Object System.Data.Odbc.OdbcConnection($cs)
$conn.Open()
Write-Host "Conectado a ADS OK" -ForegroundColor Green

$outDir = "C:\export"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

foreach ($t in $tablas) {
  try {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT * FROM [$t]"
    $rdr = $cmd.ExecuteReader()
    $path = Join-Path $outDir "$t.csv"
    $sw = New-Object System.IO.StreamWriter($path, $false, [System.Text.Encoding]::UTF8)
    $cols = for ($i=0; $i -lt $rdr.FieldCount; $i++) { $rdr.GetName($i) }
    $sw.WriteLine(($cols -join ","))
    while ($rdr.Read()) {
      $vals = for ($i=0; $i -lt $rdr.FieldCount; $i++) {
        $v = $rdr.GetValue($i)
        if ($null -eq $v -or [DBNull]::Value.Equals($v)) { "" }
        else { '"' + ($v.ToString().Replace('"','""')) + '"' }
      }
      $sw.WriteLine(($vals -join ","))
    }
    $sw.Close(); $rdr.Close()
    Write-Host "OK: $t -> $path"
  } catch {
    Write-Host "ERROR en $t : $_" -ForegroundColor Red
  }
}
$conn.Close()
Write-Host "`nListo. Archivos en $outDir" -ForegroundColor Green
