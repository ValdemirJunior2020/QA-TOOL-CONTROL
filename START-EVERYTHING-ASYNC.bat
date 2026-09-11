@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if /I "%~1"=="GATEWAY-WATCH" goto GATEWAY_WATCH

echo ============================================================
echo QA CONTROL CENTER - RELIABLE ASYNC AUTO QA
echo ============================================================
echo Repo: %CD%
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

echo [CHECK] Stopping old Auto QA Node processes so we start clean...
powershell -NoProfile -Command "$p=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -match 'autoqa[\\/]server\.mjs' -or $_.CommandLine -match 'autoqa[\\/]gateway\.mjs') }; foreach($x in $p){ try { Stop-Process -Id $x.ProcessId -Force -ErrorAction Stop; Write-Host ('[STOPPED] Auto QA PID ' + $x.ProcessId) } catch {} }"
timeout /t 1 /nobreak >nul

powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo [START] Ollama...
  start "Ollama" /min cmd /c "ollama serve"
  timeout /t 4 /nobreak >nul
)

ollama list | findstr /i /c:"qwen3:8b" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] qwen3:8b is not installed.
  echo Run: ollama pull qwen3:8b
  pause
  exit /b 1
)

echo [START] Async Auto QA gateway + worker watchdog...
start "AUTO QA ASYNC WATCHDOG" /min cmd /c call "%~f0" GATEWAY-WATCH

echo [WAIT] Waiting for the async gateway and worker...
for /L %%N in (1,1,40) do (
  powershell -NoProfile -Command "try { $r=Invoke-RestMethod -Uri 'http://127.0.0.1:8788/health?ollamaUrl=http://127.0.0.1:11434^&ollamaModel=qwen3:8b' -TimeoutSec 4; if($r.ok -and $r.gateway){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto GATEWAY_READY
  timeout /t 2 /nobreak >nul
)

echo [ERROR] Async Auto QA gateway did not become ready.
echo Check the AUTO QA ASYNC WATCHDOG window.
pause
exit /b 1

:GATEWAY_READY
echo [OK] Async Auto QA gateway is healthy on http://127.0.0.1:8788
echo.
echo [NEXT] Starting the normal Cloudflare startup flow...
echo The normal script will detect this healthy gateway and will NOT start the old server.
echo.
call "%CD%\START-EVERYTHING.bat"
exit /b %errorlevel%

:GATEWAY_WATCH
cd /d "%~dp0"
set "AUTO_QA_PYTHON=%CD%\.venv-autoqa\Scripts\python.exe"
set "AUTO_QA_OLLAMA_URL=http://127.0.0.1:11434"
set "AUTO_QA_OLLAMA_MODEL=qwen3:8b"
:GATEWAY_LOOP
echo [%date% %time%] Starting async Auto QA gateway...
node autoqa\gateway.mjs
echo [%date% %time%] Async gateway stopped. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto GATEWAY_LOOP
