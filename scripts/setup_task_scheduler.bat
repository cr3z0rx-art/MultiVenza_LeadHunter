@echo off
REM ════════════════════════════════════════════════════════════════════════════
REM  MultiVenza LeadHunter — Task Scheduler Setup
REM  Registra la tarea "MultiVenzaDailySweep" para correr a las 6:00 AM todos
REM  los días. Ejecutar como Administrador.
REM ════════════════════════════════════════════════════════════════════════════

set PROJECT_DIR=C:\Users\yildr\Desktop\MultiVenza_LeadHunter
set NODE_PATH=C:\Program Files\nodejs\node.exe
set SCRIPT=%PROJECT_DIR%\scripts\run_historical_90d.js
set LOG_DIR=%PROJECT_DIR%\.tmp\logs

mkdir "%LOG_DIR%" 2>nul

REM Eliminar tarea anterior si existe
schtasks /delete /tn "MultiVenzaDailySweep" /f 2>nul

REM Crear la tarea — 6:00 AM todos los días
schtasks /create ^
  /tn "MultiVenzaDailySweep" ^
  /tr "\"%NODE_PATH%\" \"%SCRIPT%\" >> \"%LOG_DIR%\daily_sweep.log\" 2>&1" ^
  /sc daily ^
  /st 06:00 ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f

if %ERRORLEVEL% == 0 (
  echo.
  echo  ✅ Tarea "MultiVenzaDailySweep" creada correctamente.
  echo     Horario: Todos los dias a las 06:00 AM
  echo     Script:  %SCRIPT%
  echo     Logs:    %LOG_DIR%\daily_sweep.log
  echo.
) else (
  echo.
  echo  ❌ Error al crear la tarea. Intenta ejecutar como Administrador.
  echo.
)

pause
