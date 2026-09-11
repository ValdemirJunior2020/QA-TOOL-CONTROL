@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if /I "%~1"=="GATEWAY-WATCH" goto GATEWAY_WATCH
if /I "%~1"=="TUNNEL-WATCH" goto TUNNEL_WATCH

echo ============================================================
echo QA CONTROL CENTER - ONE CLICK RELIABLE AUTO QA
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

set "CF="
for /f "delims=" %%I in ('where cloudflared 2^>nul') do if not defined CF set "CF=%%I"
if not defined CF if exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not defined CF if exist "C:\Program Files\cloudflared\cloudflared.exe" set "CF=C:\Program Files\cloudflared\cloudflared.exe"
if not defined CF (
  echo [ERROR] cloudflared was not found.
  pause
  exit /b 1
)

if not exist logs mkdir logs
set "AUTO_QA_PYTHON=%CD%\.venv-autoqa\Scripts\python.exe"
set "AUTO_QA_OLLAMA_URL=http://127.0.0.1:11434"
set "AUTO_QA_OLLAMA_MODEL=qwen3:8b"
set "GATEWAY_LOG=%CD%\logs\autoqa-gateway.log"
set "CF_LOG=%TEMP%\qa-control-cloudflare.log"
set "PUBLIC_URL="
set "TUNNEL_MODE=QUICK"

echo [CLEAN] Stopping stale Auto QA watchdogs and tunnel watchers...
powershell -NoProfile -Command "$items=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue ^| Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'START-EVERYTHING(?:-ASYNC)?\.bat.*(AUTOQA-WATCH^|GATEWAY-WATCH^|TUNNEL-WATCH)' }; foreach($x in $items){ try { Stop-Process -Id $x.ProcessId -Force -ErrorAction Stop } catch {} }" >nul 2>&1
powershell -NoProfile -Command "$items=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue ^| Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -match '--url\s+http://127\.0\.0\.1:8788' }; foreach($x in $items){ try { Stop-Process -Id $x.ProcessId -Force -ErrorAction Stop } catch {} }" >nul 2>&1

echo [CLEAN] Freeing Auto QA ports 8788 and 8789...
call :FREE_AUTOQA_PORTS
if errorlevel 1 (
  echo [ERROR] Could not free Auto QA ports 8788/8789.
  netstat -ano | findstr ":8788 :8789"
  pause
  exit /b 1
)

echo [CHECK] Ollama...
call :CHECK_OLLAMA
if errorlevel 1 (
  echo [START] Ollama...
  start "Ollama" /min cmd /c "ollama serve"
  call :WAIT_OLLAMA
  if errorlevel 1 (
    echo [ERROR] Ollama did not become ready after 60 seconds.
    pause
    exit /b 1
  )
) else (
  echo [OK] Ollama is already running.
)

ollama list | findstr /i /c:"qwen3:8b" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Ollama model qwen3:8b is not installed.
  echo Run: ollama pull qwen3:8b
  pause
  exit /b 1
)
echo [OK] qwen3:8b is installed.

del /q "%GATEWAY_LOG%" >nul 2>&1
echo [START] Async Auto QA gateway + worker watchdog...
start "AUTO QA ASYNC WATCHDOG" /min cmd /c call "%~f0" GATEWAY-WATCH

echo [WAIT] Waiting for async gateway + worker health...
call :WAIT_GATEWAY_READY
if errorlevel 1 (
  echo.
  echo [ERROR] Auto QA async gateway did not become ready.
  echo ----- Health response -----
  powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:8788/health' -TimeoutSec 8 ^| ConvertTo-Json -Depth 5 } catch { Write-Host $_.Exception.Message }"
  echo ----- Gateway log -----
  powershell -NoProfile -Command "if(Test-Path $env:GATEWAY_LOG){Get-Content $env:GATEWAY_LOG -Tail 100}else{Write-Host 'No gateway log was created.'}"
  echo ----- Port owners -----
  netstat -ano | findstr ":8788 :8789"
  pause
  exit /b 1
)
echo [OK] Async Auto QA gateway is healthy on http://127.0.0.1:8788

del /q "%CF_LOG%" >nul 2>&1
if defined AUTO_QA_TUNNEL_NAME goto START_NAMED_TUNNEL
goto START_QUICK_TUNNEL

:START_NAMED_TUNNEL
set "TUNNEL_MODE=NAMED"
set "TUNNEL_NAME=%AUTO_QA_TUNNEL_NAME%"
set "TUNNEL_CONFIG=%AUTO_QA_TUNNEL_CONFIG%"
if not defined TUNNEL_CONFIG set "TUNNEL_CONFIG=%USERPROFILE%\.cloudflared\config.yml"
if not exist "%TUNNEL_CONFIG%" (
  echo [ERROR] Named tunnel config not found: %TUNNEL_CONFIG%
  pause
  exit /b 1
)
start "CLOUDFLARE AUTO QA TUNNEL" /min cmd /c call "%~f0" TUNNEL-WATCH "%CF%" NAMED "%TUNNEL_CONFIG%" "%TUNNEL_NAME%" "%CF_LOG%"
if defined AUTO_QA_PUBLIC_URL set "PUBLIC_URL=%AUTO_QA_PUBLIC_URL%"
goto VERIFY_TUNNEL

:START_QUICK_TUNNEL
echo [START] Cloudflare Quick Tunnel...
start "CLOUDFLARE AUTO QA TUNNEL" /min cmd /c call "%~f0" TUNNEL-WATCH "%CF%" QUICK "" "" "%CF_LOG%"
call :WAIT_QUICK_URL
if errorlevel 1 (
  echo [ERROR] Cloudflare did not publish a Quick Tunnel URL.
  powershell -NoProfile -Command "if(Test-Path $env:CF_LOG){Get-Content $env:CF_LOG -Tail 80}"
  pause
  exit /b 1
)
echo [OK] Quick Tunnel URL: %PUBLIC_URL%
echo %PUBLIC_URL%| clip
echo [INFO] Public URL copied to clipboard.

:VERIFY_TUNNEL
if not defined PUBLIC_URL goto SHOW_READY
echo [CHECK] Cloudflare public health...
call :WAIT_PUBLIC_HEALTH
if errorlevel 1 (
  echo [WARNING] Local Auto QA is healthy, but the public URL health check failed.
  echo Public URL: %PUBLIC_URL%
) else (
  echo [OK] Cloudflare public endpoint is healthy.
)

:SHOW_READY
echo.
echo ============================================================
echo AUTO QA READY
echo ============================================================
echo Local   : http://127.0.0.1:8788
echo Worker  : http://127.0.0.1:8789
echo Ollama  : http://127.0.0.1:11434
echo Model   : qwen3:8b
echo Frontend: https://qa-tool-control.netlify.app/
echo Tunnel  : %TUNNEL_MODE%
if defined PUBLIC_URL echo Public   : %PUBLIC_URL%
echo.
if /I "%TUNNEL_MODE%"=="QUICK" (
  echo Paste this URL into Admin ^> Auto QA ^> Auto QA Service URL if it changed:
  echo %PUBLIC_URL%
)
echo.
echo You may lock Windows. Do not put the PC to sleep.
start "" "https://qa-tool-control.netlify.app/"
pause
exit /b 0

:FREE_AUTOQA_PORTS
for /L %%R in (1,1,5) do (
  powershell -NoProfile -Command "$ports=8788,8789; $pids=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue ^| Where-Object { $ports -contains $_.LocalPort } ^| Select-Object -ExpandProperty OwningProcess -Unique; foreach($id in $pids){ if($id){ try { $p=Get-Process -Id $id -ErrorAction Stop; Write-Host ('[STOPPED] PID '+$id+' ('+$p.ProcessName+')'); Stop-Process -Id $id -Force -ErrorAction Stop } catch {} } }" 2>nul
  timeout /t 1 /nobreak >nul
  powershell -NoProfile -Command "$x=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue ^| Where-Object { $_.LocalPort -in 8788,8789 }; if($x){exit 1}else{exit 0}" >nul 2>&1
  if not errorlevel 1 exit /b 0
)
exit /b 1

:CHECK_OLLAMA
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%

:WAIT_OLLAMA
for /L %%N in (1,1,20) do (
  call :CHECK_OLLAMA
  if not errorlevel 1 exit /b 0
  timeout /t 3 /nobreak >nul
)
exit /b 1

:CHECK_GATEWAY_READY
powershell -NoProfile -Command "try { $r=Invoke-RestMethod -Uri 'http://127.0.0.1:8788/health' -TimeoutSec 5; if($r.ok -and $r.gateway){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%

:WAIT_GATEWAY_READY
for /L %%N in (1,1,45) do (
  call :CHECK_GATEWAY_READY
  if not errorlevel 1 exit /b 0
  timeout /t 2 /nobreak >nul
)
exit /b 1

:WAIT_QUICK_URL
for /L %%N in (1,1,40) do (
  set "PUBLIC_URL="
  for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$p=$env:CF_LOG; if(Test-Path $p){$t=Get-Content $p -Raw -ErrorAction SilentlyContinue; if($t -match 'https://[a-z0-9-]+\.trycloudflare\.com'){ $matches[0] }}"`) do set "PUBLIC_URL=%%U"
  if defined PUBLIC_URL exit /b 0
  timeout /t 2 /nobreak >nul
)
exit /b 1

:WAIT_PUBLIC_HEALTH
for /L %%N in (1,1,20) do (
  powershell -NoProfile -Command "try { $r=Invoke-RestMethod -Uri '%PUBLIC_URL%/health' -TimeoutSec 8; if($r.ok -and $r.gateway){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 exit /b 0
  timeout /t 2 /nobreak >nul
)
exit /b 1

:GATEWAY_WATCH
cd /d "%~dp0"
if not exist logs mkdir logs
set "AUTO_QA_PYTHON=%CD%\.venv-autoqa\Scripts\python.exe"
set "AUTO_QA_OLLAMA_URL=http://127.0.0.1:11434"
set "AUTO_QA_OLLAMA_MODEL=qwen3:8b"
set "GATEWAY_LOG=%CD%\logs\autoqa-gateway.log"
:GATEWAY_LOOP
echo [%date% %time%] Starting async Auto QA gateway...>>"%GATEWAY_LOG%"
node autoqa\gateway.mjs >>"%GATEWAY_LOG%" 2>&1
echo [%date% %time%] Gateway stopped. Restarting in 3 seconds...>>"%GATEWAY_LOG%"
timeout /t 3 /nobreak >nul
goto GATEWAY_LOOP

:TUNNEL_WATCH
cd /d "%~dp0"
set "CF_EXE=%~2"
set "CF_MODE=%~3"
set "CF_CONFIG=%~4"
set "CF_NAME=%~5"
set "CF_LOG=%~6"
if not defined CF_LOG set "CF_LOG=%TEMP%\qa-control-cloudflare.log"
:TUNNEL_LOOP
if /I "%CF_MODE%"=="NAMED" (
  powershell -NoProfile -Command "& $env:CF_EXE tunnel --config $env:CF_CONFIG run $env:CF_NAME 2>&1 ^| Tee-Object -FilePath $env:CF_LOG -Append"
) else (
  powershell -NoProfile -Command "& $env:CF_EXE tunnel --url http://127.0.0.1:8788 2>&1 ^| Tee-Object -FilePath $env:CF_LOG -Append"
)
timeout /t 5 /nobreak >nul
goto TUNNEL_LOOP
