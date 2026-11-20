[CmdletBinding()]
param([string]$Salida = '..\Entrega Analisis Aserradero', [string]$Config = 'servicio\config.local.json')
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
# Las rutas relativas se interpretan desde la raíz del proyecto.
if (-not [IO.Path]::IsPathRooted($Config)) { $Config = Join-Path $repo $Config }
if (-not [IO.Path]::IsPathRooted($Salida)) { $Salida = Join-Path $repo $Salida }
$Salida = [IO.Path]::GetFullPath($Salida)
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) { throw 'Falta el archivo -Config. Solicite a TI una configuración privada del PRD; no la publique en el repositorio.' }
if ($Salida -eq $repo -or $Salida.StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Use -Salida fuera del repositorio: el paquete contiene configuración privada.' }
$temporal = Join-Path ([IO.Path]::GetTempPath()) ('aserradero-paquete-' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path (Join-Path $temporal 'instalador'), (Join-Path $temporal 'app\servicio') -Force | Out-Null
    foreach ($nombre in @('INSTALAR.bat','DESINSTALAR.bat','LEEME.txt')) { Copy-Item -LiteralPath (Join-Path $repo "instalador\$nombre") -Destination $temporal }
    foreach ($nombre in @('instalar.ps1','desinstalar.ps1')) { Copy-Item -LiteralPath (Join-Path $repo "instalador\$nombre") -Destination (Join-Path $temporal 'instalador') }
    Copy-Item -LiteralPath (Join-Path $repo 'dist') -Destination (Join-Path $temporal 'app\dist') -Recurse
    foreach ($nombre in @('prd.py','servicio_prd.py','LEEME.md')) { Copy-Item -LiteralPath (Join-Path $repo "servicio\$nombre") -Destination (Join-Path $temporal 'app\servicio') }
    Copy-Item -LiteralPath $Config -Destination (Join-Path $temporal 'app\servicio\config.local.json')
    New-Item -ItemType Directory -Path $Salida -Force | Out-Null
    $zip = Join-Path $Salida ('Instalador-Analisis-Aserradero-' + (Get-Date -Format 'yyyy-MM-dd') + '.zip')
    Compress-Archive -Path (Join-Path $temporal '*') -DestinationPath $zip -Force
    Write-Host "Paquete privado creado: $zip"
} finally {
    if (Test-Path -LiteralPath $temporal) {
        $raizTemporal = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (-not ([IO.Path]::GetFullPath($temporal).StartsWith($raizTemporal, [StringComparison]::OrdinalIgnoreCase))) { throw 'Ruta temporal fuera del directorio permitido.' }
        Remove-Item -LiteralPath $temporal -Recurse -Force
    }
}