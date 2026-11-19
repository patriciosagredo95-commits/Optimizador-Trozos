@echo off
cd /d "%~dp0"
start "" /b pythonw -X utf8 servicio_prd.py
echo Servicio iniciado. Abra http://localhost:8766/
echo Si cambio el puerto, use el indicado en config.local.json.
pause
