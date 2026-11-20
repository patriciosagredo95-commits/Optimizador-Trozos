[CmdletBinding()]
param(
    [string]$Destino = "$env:LOCALAPPDATA\AnalisisAserradero",
    [ValidateRange(1,65535)][int]$Puerto,
    [switch]$SinAccesos, [switch]$SinNavegador, [switch]$UsarClaveGuardada,
    [switch]$Monitor, [switch]$NoMonitor
)
$ErrorActionPreference = 'Stop'
$Destino = [IO.Path]::GetFullPath($Destino).TrimEnd('\')
$paquete = Split-Path $PSScriptRoot -Parent
$transcribiendo = $false
function Paso($n, $texto) { Write-Host "`n[$n/11] $texto" }
function Preguntar($texto) { return (Read-Host $texto) -match '^(s|si|sí)$' }
function Buscar-Python {
    $opciones = @(@{exe='py'; args=@('-3')}, @{exe='python'; args=@()})
    foreach ($patron in @("$env:LOCALAPPDATA\Python\pythoncore-*\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe")) {
        foreach ($archivo in @(Get-Item -Path $patron -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) {
            $opciones += @{exe=$archivo.FullName; args=@()}
        }
    }
    foreach ($opcion in $opciones) {
        try {
            $exe = $opcion.exe; $argumentos = $opcion.args
            $salida = & $exe @argumentos -c 'import sys,json; print(json.dumps(dict(exe=sys.executable,ok=sys.version_info >= (3,10))))' 2>$null
            if ($LASTEXITCODE -ne 0) { continue }
            $dato = ($salida -join '') | ConvertFrom-Json
            $w = Join-Path (Split-Path $dato.exe) 'pythonw.exe'
            if ($dato.ok -and $dato.exe -notmatch '\\WindowsApps\\' -and (Test-Path -LiteralPath $w)) {
                return @{python=$dato.exe; pythonw=$w}
            }
        } catch { }
    }
    return $null
}
function Crear-Acceso($ruta, $exe, $argumentos, $trabajo) {
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($ruta)
    $lnk.TargetPath = $exe; $lnk.Arguments = $argumentos
    $lnk.WorkingDirectory = $trabajo; $lnk.WindowStyle = 7; $lnk.Save()
}
try {
    if ($Monitor -and $NoMonitor) { throw 'Use solo -Monitor o -NoMonitor.' }
    if ($Destino -eq [IO.Path]::GetPathRoot($Destino).TrimEnd('\') -or $Destino -eq $paquete -or $paquete.StartsWith($Destino + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Elija una carpeta exclusiva para la aplicación.' }
    $fuente = Join-Path $paquete 'app'
    $configFuente = Join-Path $fuente 'servicio\config.local.json'
    if (-not (Test-Path -LiteralPath $configFuente)) { throw 'Falta la configuración del paquete. Solicite un paquete completo a TI.' }
    $config = Get-Content -LiteralPath $configFuente -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $PSBoundParameters.ContainsKey('Puerto')) { $Puerto = [int]$config.puerto; if (-not $Puerto) { $Puerto = 8766 } }
    if ($Puerto -lt 1 -or $Puerto -gt 65535) { throw 'El puerto configurado no es válido.' }
    New-Item -ItemType Directory -Path $Destino -Force | Out-Null
    Start-Transcript -Path (Join-Path $Destino 'instalacion.log') -Append | Out-Null
    $transcribiendo = $true
    Paso 1 'Buscando Python 3.10 o superior...'
    $py = Buscar-Python
    if (-not $py) {
        Write-Host 'Intentando instalar Python para este usuario...'
        try {
            & winget install -e --id Python.Python.3.13 --scope user --silent --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -ne 0) { Write-Host "winget terminó con código $LASTEXITCODE." }
        } catch { Write-Host $_.Exception.Message }
        $py = Buscar-Python
    }
    if (-not $py) {
        Write-Host 'Instale Python desde python.org para su usuario. Marque "Add python.exe to PATH". Después repita INSTALAR.bat.'
        Start-Process 'https://www.python.org/downloads/windows/'
        throw 'No se encontró Python compatible con pythonw.exe.'
    }
    $python = $py.python; $pythonw = $py.pythonw
    Write-Host "Python: $python"
    Paso 2 'Buscando Google Chrome...'
    $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $chrome) { throw 'Falta Google Chrome. Instálelo para su usuario o pida ayuda a TI y repita INSTALAR.bat.' }
    Paso 3 'Instalando Playwright. Se necesita internet...'
    & $python -m pip install --user --upgrade playwright
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar Playwright. Muestre a TI el error anterior y solicite acceso a pip/PyPI a través del proxy de la empresa.' }
    Paso 4 'Deteniendo solamente el servicio instalado en esta carpeta...'
    $scriptServicio = Join-Path $Destino 'servicio\servicio_prd.py'
    $patron = '(?i)(?:^|[\s"])' + [regex]::Escape($scriptServicio) + '(?:"|\s|$)'
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" | Where-Object { $_.CommandLine -match $patron } | ForEach-Object { & taskkill /PID $_.ProcessId /T /F | Out-Null; Start-Sleep -Seconds 3 }  # con Playwright y Chrome
    # No continuar si otro servicio ocupa el puerto: evita confundir su estado con el nuestro.
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Puerto)
    try { $listener.Start() } catch { throw "El puerto $Puerto ya está ocupado. Cierre esa instancia o elija otro puerto." } finally { $listener.Stop() }
    Paso 5 'Copiando la aplicación. Se conserva el caché existente...'
    Copy-Item -Path (Join-Path $fuente '*') -Destination $Destino -Recurse -Force
    if ($PSBoundParameters.ContainsKey('Puerto')) {
        $config | Add-Member -NotePropertyName puerto -NotePropertyValue $Puerto -Force
        $config | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $Destino 'servicio\config.local.json') -Encoding UTF8
    }
    Paso 6 'Preparando la clave del PRD...'
    if ($UsarClaveGuardada) { Write-Host 'Se usará la credencial guardada, sin modificarla.' }
    else {
        $guardada = (& cmdkey /list:PRD_SYNC_Glover | Out-String) -match 'PRD_SYNC_Glover'
        $usar = $false
        if ($guardada) { $usar = Preguntar 'Ya hay una clave guardada. ¿Usarla? (S/N)' }
        if (-not $usar) {
            $usuario = Read-Host 'Usuario del PRD'
            if ([string]::IsNullOrWhiteSpace($usuario)) { throw 'Debe ingresar el usuario del PRD.' }
            Write-Host 'Ingrese la clave cuando Windows la solicite. No se mostrará en pantalla.'
            Stop-Transcript | Out-Null; $transcribiendo = $false
            & cmdkey /generic:PRD_SYNC_Glover "/user:$usuario" /pass
            $codigoClave = $LASTEXITCODE
            Start-Transcript -Path (Join-Path $Destino 'instalacion.log') -Append | Out-Null; $transcribiendo = $true
            if ($codigoClave -ne 0) { throw 'Windows no pudo guardar la clave. Repita la instalación.' }
            Write-Host 'Credencial guardada en Windows.'
        }
    }
    Paso 7 'Definiendo el uso del PC...'
    $esMonitor = [bool]$Monitor
    if (-not $Monitor -and -not $NoMonitor) { $esMonitor = Preguntar '¿Este PC es el monitor en piso? (S/N)' }
    Paso 8 'Preparando accesos e inicio automático...'
    if (-not $SinAccesos) {
        $inicio = [Environment]::GetFolderPath('Startup'); $escritorio = [Environment]::GetFolderPath('Desktop')
        Crear-Acceso (Join-Path $inicio 'Servicio PRD Aserradero.lnk') $pythonw ('-X utf8 "' + $scriptServicio + '"') (Split-Path $scriptServicio)
        "[InternetShortcut]`r`nURL=http://localhost:$Puerto/#analisis" | Set-Content -LiteralPath (Join-Path $escritorio 'Aserradero.url') -Encoding ASCII
        foreach ($carpeta in @($inicio, $escritorio)) {
            $rutaMonitor = Join-Path $carpeta 'Monitor Aserradero.lnk'
            if ($esMonitor) { Crear-Acceso $rutaMonitor $chrome "--kiosk --noerrdialogs --disable-session-crashed-bubble `"http://localhost:$Puerto/#monitor`"" (Split-Path $chrome) }
            elseif (Test-Path -LiteralPath $rutaMonitor) { Remove-Item -LiteralPath $rutaMonitor }
        }
    }
    if ($esMonitor) {
        foreach ($ajuste in @('standby-timeout-ac', 'monitor-timeout-ac')) {
            & powercfg /change $ajuste 0
            if ($LASTEXITCODE -ne 0) { Write-Host 'Pida a TI desactivar suspensión y apagado de pantalla cuando el PC esté conectado a corriente.' }
        }
    }
    Paso 9 'Iniciando el servicio y esperando respuesta (hasta 120 segundos)...'
    Start-Process -FilePath $pythonw -ArgumentList ('-X utf8 "' + $scriptServicio + '"') -WorkingDirectory (Split-Path $scriptServicio) -WindowStyle Hidden
    $limite = (Get-Date).AddSeconds(120); $respondio = $false; $resultado = $false
    do {
        try {
            $estado = Invoke-RestMethod "http://127.0.0.1:$Puerto/api/estado" -TimeoutSec 3
            $respondio = $true
            if ($estado.error) {
                Write-Host "El servicio respondió: $($estado.error)"
                if ($estado.error -match 'clave|credencial|autentic|contrase|401|403') { Write-Host 'Repita INSTALAR.bat e ingrese el usuario y la clave correctos del PRD.' }
                else { Write-Host 'Pida a TI revisar la configuración del paquete y la conexión a la red del PRD.' }
                if ($estado.sugerencia) { Write-Host $estado.sugerencia }
                $resultado = $true; break
            }
            if ($estado.hoyConsultado) { Write-Host ('Conectado al PRD: datos de hoy a las ' + ([datetime]$estado.hoyConsultado).ToString('HH:mm')); $resultado = $true; break }
        } catch { }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $limite)
    if (-not $resultado) {
        if ($respondio) { Write-Host 'El servicio responde, pero todavía no completó la consulta de hoy.' }
        else { Write-Host 'El servicio no respondió.' }
        Write-Host "Revise el registro: $env:TEMP\servicio_prd_aserradero.log"
    }
    Paso 10 'Abriendo Análisis Aserradero...'
    if (-not $SinNavegador) {
        if ($esMonitor) { Start-Process $chrome -ArgumentList "--kiosk --noerrdialogs --disable-session-crashed-bubble `"http://localhost:$Puerto/#monitor`"" }
        else { Start-Process "http://localhost:$Puerto/#analisis" }
    }
    Paso 11 'Instalación terminada.'
    Write-Host "Aplicación: $Destino`nDirección: http://localhost:$Puerto/#analisis`nMonitor en piso: $esMonitor`nRegistro: $Destino\instalacion.log"
    if ($SinAccesos) { Write-Host 'No se crearon accesos directos ni inicio automático.' }
} catch {
    Write-Host "`nNo se pudo completar la instalación: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally { if ($transcribiendo) { Stop-Transcript | Out-Null } }