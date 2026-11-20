[CmdletBinding()]
param([string]$Destino = "$env:LOCALAPPDATA\AnalisisAserradero")
$ErrorActionPreference = 'Stop'
try {
    $Destino = [IO.Path]::GetFullPath($Destino).TrimEnd('\')
    if (-not (Test-Path -LiteralPath (Join-Path $Destino 'servicio\servicio_prd.py'))) { throw 'No se encontró la aplicación en ese destino. No se borró nada.' }
    $prohibidos = @([IO.Path]::GetPathRoot($Destino).TrimEnd('\'), $env:USERPROFILE, $env:LOCALAPPDATA, $env:TEMP, (Split-Path $PSScriptRoot -Parent))
    if ($Destino -in $prohibidos) { throw 'El destino debe ser una carpeta exclusiva de la aplicación.' }
    if (@(Get-Item -LiteralPath $Destino; Get-ChildItem -LiteralPath $Destino -Recurse -Force) | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'El destino contiene enlaces de carpetas. Solicite revisión a TI antes de borrar.' }
    Write-Host '[1/4] Deteniendo solamente el servicio de esta instalación...'
    $scriptServicio = Join-Path $Destino 'servicio\servicio_prd.py'
    $patron = '(?i)(?:^|[\s"])' + [regex]::Escape($scriptServicio) + '(?:"|\s|$)'
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" | Where-Object { $_.CommandLine -match $patron } | ForEach-Object { & taskkill /PID $_.ProcessId /T /F | Out-Null }  # con sus procesos hijos (Playwright y Chrome)
    Write-Host '[2/4] Quitando accesos directos...'
    # El acceso del servicio se borra solo si apunta a ESTA instalación (otro PC/carpeta puede usar el mismo nombre).
    $shell = New-Object -ComObject WScript.Shell
    foreach ($carpeta in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('Desktop'))) {
        foreach ($nombre in @('Servicio PRD Aserradero.lnk', 'Monitor Aserradero.lnk', 'Aserradero.url')) {
            $ruta = Join-Path $carpeta $nombre
            if (-not (Test-Path -LiteralPath $ruta)) { continue }
            if ($nombre -eq 'Servicio PRD Aserradero.lnk' -and $shell.CreateShortcut($ruta).Arguments -notmatch [regex]::Escape($scriptServicio)) {
                Write-Host "Se conserva $nombre porque apunta a otra instalación."; continue
            }
            Remove-Item -LiteralPath $ruta -Force
        }
    }
    Write-Host '[3/4] Borrando la carpeta de la aplicación...'
    # Chrome y Playwright tardan unos segundos en soltar la carpeta: se reintenta hasta 15 s.
    $intentos = 0
    while ($true) { try { Remove-Item -LiteralPath $Destino -Recurse -Force -ErrorAction Stop; break } catch { if (++$intentos -ge 15) { throw }; Start-Sleep -Seconds 1 } }
    Write-Host '[4/4] Clave guardada en Windows...'
    if ((Read-Host '¿Borrar también la credencial PRD_SYNC_Glover? (S/N)') -match '^(s|si|sí)$') {
        & cmdkey /delete:PRD_SYNC_Glover
        if ($LASTEXITCODE -ne 0) { Write-Host 'No se pudo borrar la credencial o ya no existía.' }
    }
    Write-Host 'Desinstalación terminada. Los ajustes de energía del monitor se conservan.'
} catch { Write-Host "No se pudo completar: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }