@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-everything.ps1"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [OK] One-click startup finished.
) else (
  echo [FAILED] One-click startup did not complete. Review the error above.
)
echo.
pause
exit /b %RC%
