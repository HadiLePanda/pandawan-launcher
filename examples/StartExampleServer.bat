@echo off
setlocal

cd /d "%~dp0"

set "PORT=8765"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
    echo Port %PORT% is already in use. Stopping existing server...
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 1 /nobreak >nul
)

echo ==========================================
echo  Pandawan local example server
echo  URL: http://localhost:%PORT%
echo  Root: %CD%
echo ==========================================
echo.
echo Press Ctrl+C to stop the server cleanly.
echo.

python -u -m http.server %PORT%

echo.
echo Server stopped.
pause
endlocal
