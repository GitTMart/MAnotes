@echo off
cd /d "%~dp0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4500" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>nul
)
start "" "http://localhost:4500"
node server.js
pause
