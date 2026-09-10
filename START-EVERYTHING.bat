@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if /I "%~1"=="AUTOQA-WATCH" goto AUTOQA_WATCH
if /I "%~1"=="TUNNEL-WATCH" goto TUNNEL_WATCH

echo ============================================================
echo QA CONTROL CENTER - START EVERYTHING
echo ============================================================
echo.

if not exist ".venv-autoqa\Scripts\python.exe" (
  echo [ERROR] Auto QA Python environment is missing.
  echo Run INSTALL-AUTO-QA.bat first.
  pause
  exit /b 1
)

where node >nul 2>&1 || (
  echo [ERROR] Node.js is not available in PATH.
  pause
  exit /b 1
)

where ollama >nul 2>&1 || (
  echo [ERROR] Ollama is not available in PATH.
  pause
  exit /b 1
)

set "CF="
for /f "delims=" %%I in ('where cloudflared 2^>nul') do if not defined CF set "CF=%%I"
if not defined CF if exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not defined CF if exist "C:\Program Files\cloudflared\cloudflared.exe" set "CF=C:\Program Files\cloudflared\cloudflared.exe"

if not defined CF (
  echo [ERROR] cloudflared was not found.
  echo Install Cloudflare Tunnel first.
  pause
  exit /b 1
)

set "AUTO_QA_PYTHON=%CD%\.venv-autoqa\Scripts\python.exe"

powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo [START] Ollama...
  start "Ollama" /min cmd /c "ollama serve"
  timeout /t 3 /nobreak >nul
) else (
  echo [OK] Ollama is already running.
)

echo [START] Auto QA watchdog...
start "AUTO QA WATCHDOG" /min cmd /c call "%~f0" AUTOQA-WATCH

timeout /t 2 /nobreak >nul

echo [START] Cloudflare Quick Tunnel watchdog...
start "CLOUDFLARE AUTO QA TUNNEL" cmd /c call "%~f0" TUNNEL-WATCH "%CF%"

timeout /t 2 /nobreak >nul

echo.
echo ============================================================
echo EVERYTHING STARTED
echo ============================================================
echo Auto QA : http://127.0.0.1:8788
echo Ollama  : http://127.0.0.1:11434
echo Frontend: https://qa-tool-control.netlify.app/
echo.
echo IMPORTANT:
echo - Keep the Cloudflare window running.
echo - The Auto QA server watchdog will restart the server if it crashes.
echo - The Cloudflare watchdog will restart the tunnel if it crashes.
echo - A restarted Quick Tunnel can receive a NEW trycloudflare.com URL.
echo   If that happens, update Admin ^> Auto QA Service URL with the new URL.
echo.
echo Opening the QA tool...
start "" "https://qa-tool-control.netlify.app/"
echo.
pause
exit /b 0

:AUTOQA_WATCH
cd /d "%~dp0"
set "AUTO_QA_PYTHON=%CD%\.venv-autoqa\Scripts\python.exe"
:SERVER_LOOP
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 start "Ollama" /min cmd /c "ollama serve"
echo [%date% %time%] Starting Auto QA server...
node autoqa\server.mjs
echo [%date% %time%] Auto QA server stopped. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto SERVER_LOOP

:TUNNEL_WATCH
cd /d "%~dp0"
set "CF=%~2"
if not defined CF (
  echo cloudflared path was not supplied.
  timeout /t 10
  exit /b 1
)
:TUNNEL_LOOP
echo.
echo ============================================================
echo CLOUDFLARE QUICK TUNNEL
echo Copy the https://xxxxx.trycloudflare.com URL if it changes.
echo ============================================================
"%CF%" tunnel --url http://127.0.0.1:8788
echo.
echo [%date% %time%] Tunnel stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto TUNNEL_LOOP
