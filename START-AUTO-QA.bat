@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo QA CONTROL CENTER - START LOCAL AUTO QA ONLY
echo ============================================================
echo.

if not exist ".venv-autoqa\Scripts\python.exe" (
  echo [ERROR] Auto QA is not installed yet.
  echo Run INSTALL-AUTO-QA.bat first.
  pause
  exit /b 1
)

where node >nul 2>&1 || (
  echo [ERROR] Node.js is not installed or not in PATH.
  pause
  exit /b 1
)
where ollama >nul 2>&1 || (
  echo [ERROR] Ollama is not installed or not in PATH.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo [START] Ollama...
  start "Ollama" /min cmd /c "ollama serve"
  timeout /t 3 /nobreak >nul
) else (
  echo [OK] Ollama is already running.
)

ollama list | findstr /i /c:"qwen3:8b" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] qwen3:8b is not installed.
  echo Run: ollama pull qwen3:8b
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8788/health' -TimeoutSec 3 | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } else { exit 1 } }" >nul 2>&1
if not errorlevel 1 (
  echo [INFO] Something is already listening on port 8788.
  echo Use START-EVERYTHING.bat for the full verified startup/watchdog flow.
  pause
  exit /b 0
)

set "AUTO_QA_PYTHON=%CD%\.venv-autoqa\Scripts\python.exe"
set "AUTO_QA_OLLAMA_URL=http://127.0.0.1:11434"
set "AUTO_QA_OLLAMA_MODEL=qwen3:8b"

echo [START] Auto QA on http://127.0.0.1:8788
echo Press Ctrl+C to stop it.
echo.
node autoqa\server.mjs

echo.
echo [STOPPED] Auto QA server exited.
pause
