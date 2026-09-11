@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo QA CONTROL CENTER - LOCAL KNOWLEDGE INSTALLER
echo txtai + LightRAG + ai-memory
echo ============================================================
echo.

if not exist ".venv-autoqa\Scripts\python.exe" (
  echo [ERROR] Auto QA Python environment is missing.
  echo Run INSTALL-AUTO-QA.bat first.
  pause
  exit /b 1
)

set "PY=.venv-autoqa\Scripts\python.exe"

echo [CHECK] txtai...
"%PY%" -c "import txtai" >nul 2>&1
if errorlevel 1 (
  echo [INSTALL] txtai...
  "%PY%" -m pip install "txtai>=9.0.0"
  if errorlevel 1 (
    echo [ERROR] txtai installation failed.
    pause
    exit /b 1
  )
) else (
  echo [OK] txtai already installed - skipping.
)

echo [CHECK] LightRAG...
"%PY%" -c "import lightrag" >nul 2>&1
if errorlevel 1 (
  echo [INSTALL] LightRAG...
  "%PY%" -m pip install "lightrag-hku"
  if errorlevel 1 (
    echo [ERROR] LightRAG installation failed.
    pause
    exit /b 1
  )
) else (
  echo [OK] LightRAG already installed - skipping.
)

echo [CHECK] Local embedding model...
where ollama >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Ollama is required.
  pause
  exit /b 1
)

ollama list | findstr /i /c:"nomic-embed-text" >nul 2>&1
if errorlevel 1 (
  echo [INSTALL] Downloading local nomic-embed-text model...
  ollama pull nomic-embed-text
  if errorlevel 1 (
    echo [ERROR] Could not download nomic-embed-text.
    pause
    exit /b 1
  )
) else (
  echo [OK] nomic-embed-text already installed - skipping.
)

echo.
echo [CHECK] ai-memory local service support...
where docker >nul 2>&1
if errorlevel 1 (
  echo [INFO] Docker was not found. Auto QA will still use txtai + LightRAG.
  echo [INFO] ai-memory recall will automatically activate later if a local ai-memory service is available.
) else (
  docker info >nul 2>&1
  if errorlevel 1 (
    echo [INFO] Docker is installed but not running. Start Docker Desktop later to enable ai-memory.
  ) else (
    docker image inspect akitaonrails/ai-memory:latest >nul 2>&1
    if errorlevel 1 (
      echo [INSTALL] Downloading ai-memory local container...
      docker pull akitaonrails/ai-memory:latest
      if errorlevel 1 echo [WARNING] ai-memory image download failed. txtai + LightRAG are still installed.
    ) else (
      echo [OK] ai-memory image already installed - skipping.
    )
  )
)

echo.
echo [OK] Local knowledge stack is ready.
echo [OK] No paid AI API key was configured.
echo [OK] No .env file was changed.
echo.
pause
