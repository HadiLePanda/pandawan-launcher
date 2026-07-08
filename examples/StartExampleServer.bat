@echo off
setlocal

cd /d "%~dp0"

set "PORT=8765"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
    echo Port %PORT% is already in use. Stopping existing server...
    taskkill /PID %%a /F >nul 2>&1
)

echo Starting local Pandawan example server on port %PORT%...
start "Pandawan Example Server" cmd /k "python -m http.server %PORT%"

echo Server window opened. Close that window to stop the server.
endlocal
