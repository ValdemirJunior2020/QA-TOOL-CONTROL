@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where docker >nul 2>&1
if errorlevel 1 exit /b 0

docker info >nul 2>&1
if errorlevel 1 exit /b 0

docker ps --format "{{.Names}}" | findstr /i /x "qa-ai-memory" >nul 2>&1
if not errorlevel 1 exit /b 0

docker ps -a --format "{{.Names}}" | findstr /i /x "qa-ai-memory" >nul 2>&1
if not errorlevel 1 (
  docker start qa-ai-memory >nul 2>&1
  exit /b 0
)

docker image inspect akitaonrails/ai-memory:latest >nul 2>&1
if errorlevel 1 exit /b 0

docker run -d --name qa-ai-memory --restart unless-stopped -p 127.0.0.1:49374:49374 -v qa-ai-memory-data:/data -e AI_MEMORY_ENABLE_WEB=true akitaonrails/ai-memory:latest >nul 2>&1
exit /b 0
