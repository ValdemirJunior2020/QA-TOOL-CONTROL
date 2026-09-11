@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Redirecting to the new one-click Auto QA launcher...
call "%~dp0START-EVERYTHING.bat"
exit /b %errorlevel%
