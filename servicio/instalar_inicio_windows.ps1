param([switch]$Desinstalar)
$ErrorActionPreference = 'Stop'
$inicio = [Environment]::GetFolderPath('Startup')
$destino = Join-Path $inicio 'Servicio PRD Aserradero.lnk'
if ($Desinstalar) {
    if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino }
    Write-Host 'Inicio automático desinstalado.'
    exit
}
# Se usa el pythonw.exe real de la instalación (no el alias de WindowsApps), igual que el servicio de stock SAP.
$pythonw = $null
$python = Get-Command python.exe -ErrorAction SilentlyContinue
if ($python) {
    $real = & $python.Source -c "import sys, pathlib; print(pathlib.Path(sys.executable).with_name('pythonw.exe'))"
    if ($real -and (Test-Path -LiteralPath $real)) { $pythonw = $real }
}
if (-not $pythonw) { $pythonw = (Get-Command pythonw.exe -ErrorAction Stop).Source }
$script = Join-Path $PSScriptRoot 'servicio_prd.py'
$shell = New-Object -ComObject WScript.Shell
$acceso = $shell.CreateShortcut($destino)
$acceso.TargetPath = $pythonw
$acceso.Arguments = '-X utf8 "' + $script + '"'
$acceso.WorkingDirectory = $PSScriptRoot
$acceso.WindowStyle = 7
$acceso.Save()
Write-Host 'Inicio automático instalado para el próximo ingreso a Windows.'
