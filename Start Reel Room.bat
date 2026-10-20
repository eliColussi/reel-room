@echo off
REM Double-click this file on Windows to start Reel Room.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Reel Room needs Node.js ^(free^). Opening the download page...
  start https://nodejs.org/en/download
  pause
  exit /b 1
)
node server.js
pause
