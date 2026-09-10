@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo QA CONTROL CENTER - LOCAL AUTO QA INSTALLER
echo ============================================================

where node >nul 2>&1 || (echo [ERROR] Node.js is required.& pause & exit /b 1)
where ffmpeg >nul 2>&1 || (echo [ERROR] FFmpeg is required in PATH.& pause & exit /b 1)
where ollama >nul 2>&1 || (echo [ERROR] Ollama is required.& pause & exit /b 1)

set "PY_EXE="
set "PY_ARGS="

rem 1) Windows Python launcher
py -3.12 -c "import sys; raise SystemExit(0 if sys.version_info[:2]==(3,12) else 1)" >nul 2>&1 && (
  set "PY_EXE=py"
  set "PY_ARGS=-3.12"
)
if not defined PY_EXE py -3.11 -c "import sys; raise SystemExit(0 if sys.version_info[:2]==(3,11) else 1)" >nul 2>&1 && (
  set "PY_EXE=py"
  set "PY_ARGS=-3.11"
)

rem 2) Versioned executables in PATH
if not defined PY_EXE for %%P in (python3.12.exe python312.exe python3.11.exe python311.exe) do (
  where %%P >nul 2>&1 && if not defined PY_EXE (
    for /f "delims=" %%V in ('%%P -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do (
      if "%%V"=="3.11" set "PY_EXE=%%P"
      if "%%V"=="3.12" set "PY_EXE=%%P"
    )
  )
)

rem 3) Normal python.exe in PATH, but only accept 3.11/3.12
if not defined PY_EXE where python.exe >nul 2>&1 && (
  for /f "delims=" %%V in ('python.exe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do (
    if "%%V"=="3.11" set "PY_EXE=python.exe"
    if "%%V"=="3.12" set "PY_EXE=python.exe"
  )
)

rem 4) Common per-user install locations
if not defined PY_EXE for %%P in (
  "%LocalAppData%\Programs\Python\Python312\python.exe"
  "%LocalAppData%\Programs\Python\Python311\python.exe"
  "%ProgramFiles%\Python312\python.exe"
  "%ProgramFiles%\Python311\python.exe"
  "%ProgramFiles(x86)%\Python312\python.exe"
  "%ProgramFiles(x86)%\Python311\python.exe"
) do (
  if exist "%%~P" if not defined PY_EXE set "PY_EXE=%%~P"
)

rem 5) Search common Python folders if still not found
if not defined PY_EXE (
  for /d %%D in ("%LocalAppData%\Programs\Python\Python3*" "%ProgramFiles%\Python3*" "%ProgramFiles(x86)%\Python3*") do (
    if exist "%%~D\python.exe" if not defined PY_EXE (
      for /f "delims=" %%V in ('"%%~D\python.exe" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do (
        if "%%V"=="3.11" set "PY_EXE=%%~D\python.exe"
        if "%%V"=="3.12" set "PY_EXE=%%~D\python.exe"
      )
    )
  )
)

if not defined PY_EXE (
  echo.
  echo [ERROR] Python 3.11 or 3.12 was not found.
  echo.
  echo The installer checked the Windows launcher, PATH, and common install folders.
  echo Your Python 3.14 will NOT be used for Auto QA.
  echo.
  echo Run these commands in PowerShell and send me the output:
  echo   py -0p
  echo   where.exe python
  echo   Get-ChildItem "$env:LOCALAPPDATA\Programs\Python" -Directory
  echo.
  pause
  exit /b 1
)

echo [OK] Using Python: %PY_EXE% %PY_ARGS%
"%PY_EXE%" %PY_ARGS% -c "import sys; print('[OK] Python version:', sys.version)" 2>nul
if errorlevel 1 (
  %PY_EXE% %PY_ARGS% -c "import sys; print('[OK] Python version:', sys.version)"
)

if exist ".venv-autoqa\Scripts\python.exe" (
  for /f "delims=" %%V in ('".venv-autoqa\Scripts\python.exe" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do set "VENV_VER=%%V"
  if not "!VENV_VER!"=="3.11" if not "!VENV_VER!"=="3.12" (
    echo Existing Auto QA environment uses Python !VENV_VER!. Recreating it...
    rmdir /s /q ".venv-autoqa"
  )
)

if not exist ".venv-autoqa\Scripts\python.exe" (
  echo Creating isolated Auto QA Python environment...
  "%PY_EXE%" %PY_ARGS% -m venv .venv-autoqa
  if errorlevel 1 (
    echo [ERROR] Could not create .venv-autoqa
    pause
    exit /b 1
  )
)

echo Updating pip...
".venv-autoqa\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 (
  echo [ERROR] pip upgrade failed.
  pause
  exit /b 1
)

".venv-autoqa\Scripts\python.exe" -c "import faster_whisper" >nul 2>&1
if errorlevel 1 (
  echo Installing faster-whisper...
  ".venv-autoqa\Scripts\python.exe" -m pip install faster-whisper
  if errorlevel 1 (
    echo [ERROR] faster-whisper installation failed.
    pause
    exit /b 1
  )
) else (
  echo [OK] faster-whisper already installed - skipping.
)

ollama list | findstr /i /c:"qwen3:8b" >nul 2>&1
if errorlevel 1 (
  echo qwen3:8b is not installed. Downloading it with Ollama...
  ollama pull qwen3:8b
  if errorlevel 1 (
    echo [ERROR] Could not download qwen3:8b.
    pause
    exit /b 1
  )
) else (
  echo [OK] qwen3:8b already installed - skipping.
)

echo.
echo [OK] Auto QA dependencies are ready.
echo Run START-AUTO-QA.bat before using Auto QA.
pause
