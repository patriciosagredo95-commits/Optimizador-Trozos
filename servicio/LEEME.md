# Servicio PRD Aserradero

Consulta producción en segundo plano, sin abrir Chrome visible. Atiende solamente en este PC y guarda los días consultados, incluidos los días sin producción. La app se abre en http://localhost:8766/.

1. Requiere Windows, Chrome y Python 3.14. Instale Playwright con `python -m pip install playwright`.
2. Copie `config.example.json` a `config.local.json` y coloque la dirección interna del PRD en `base`. Este archivo es privado: no lo suba a GitHub. Puede ajustar puerto, intervalo, días de histórico (1–120) y orígenes adicionales.
3. Guarde la clave en una consola: `cmdkey /generic:PRD_SYNC_Glover /user:USUARIO /pass`.
4. Abra `Iniciar servicio PRD.bat`. Para iniciar con Windows, ejecute `instalar_inicio_windows.ps1`; para quitar ese inicio, ejecútelo con `-Desinstalar`. No hace falta instalarlo nuevamente cada día. Reinicie el servicio si cambia la configuración.

Consulta hoy al arrancar y cada 2 minutos entre 07:45 y 17:00 (turno 08:00-16:30 con márgenes), cualquier día; fuera de ese horario cada 10 minutos. Los horarios e intervalos son configurables; `intervalo_hoy_min` antiguo se usa como intervalo fuera de turno si no se define `intervalo_fuera_min`. Completa hasta 60 días anteriores, del más reciente al más antiguo. Cada hora y al cambiar de día revisa los tres días anteriores y completa faltantes. Cada consulta pide un solo día completo; los m³ de consumo son JAS y se conserva su precisión. La fecha utilizada es la fecha local del PC; mantenga Windows en la zona horaria de la planta.

API: `/api/estado`, `/api/hoy` y `/api/historico?dias=30` (1–120, excluye hoy y días sin producción ni consumo). El estado informa errores y fechas de última consulta. Ante fallas conserva los datos anteriores y reintenta en el siguiente ciclo. Hoy devuelve 503 hasta disponer de datos; con datos guardados puede mostrar la última lectura, indicada por `consultado`.

El caché privado está en `cache/prd_dias.json`. Para revisar el registro abra `%TEMP%\servicio_prd_aserradero.log` desde Ejecutar de Windows. Se trunca al iniciar si supera 1 MB. Si falta configuración, el servidor sigue atendiendo para mostrar el error. Una segunda instancia termina sin error si el puerto está ocupado.

Pruebas sin red: desde la raíz, `python -m unittest discover -s servicio/tests -v`.

La sesión y el navegador invisible se mantienen durante el turno; se renuevan cada 60 minutos y se cierran ante fallas, fuera de turno y al detener el servicio. El histórico incluye `trozosPLC`; hoy agrega `calidad` y `plcMuestras` (muestras PLC del día, incluso reinicios). `/api/estado` informa el intervalo vigente y `turno` con inicio, fin y colación. El caché versión 2 descarta versiones anteriores para completar nuevamente el histórico.
