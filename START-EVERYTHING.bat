@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0START-AI-MEMORY.bat" call "%~dp0START-AI-MEMORY.bat"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-everything.ps1"
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
  echo [FAILED] One-click startup did not complete. Review the error above.
  echo.
  pause
  exit /b %RC%
)

echo ============================================================
echo AUTO QA SERVER IS RUNNING - KEEP THIS WINDOW OPEN
echo ============================================================
echo You can MINIMIZE this window.
echo Do not close it while Junior or Barbara are using Auto QA.
echo Local health is checked every 10 seconds.
echo ============================================================

:MONITOR
powershell -NoProfile -Command "try { $r=Invoke-RestMethod -Uri 'http://127.0.0.1:8788/health' -TimeoutSec 5; if($r.ok -and $r.gateway){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] [WARNING] Auto QA local health check failed. Check logs\autoqa-gateway-error.log
)
timeout /t 10 /nobreak >nul
goto MONITOR
