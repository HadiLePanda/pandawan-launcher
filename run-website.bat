@echo off
REM Run the Pandawan website locally. This is the only copy of the runner: the
REM website lives in the sibling checkout pandawan-launcher-site, which has no
REM runner of its own.
REM
REM   run-website.bat           start it
REM   run-website.bat stop      stop one left running from an earlier session
REM
REM wrangler serves the built page plus the Pages Functions on port 8788, so
REM downloads.json and latest.json resolve the same way they do in production.
REM The window runs the server in the foreground, so closing it stops the server.

setlocal
set SITE=%~dp0..\pandawan-launcher-site
set PORT=8788

if /i "%~1"=="stop" goto :stop

REM ---------------------------------------------------------------- preflight
REM The site is a sibling checkout a developer may simply not have, so name the
REM path instead of reporting a failure.
if not exist "%SITE%\package.json" (
  echo.
  echo ERROR: site repo not found at %SITE%
  echo        Clone pandawan-launcher-site next to this folder to run the website.
  goto :fail
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: node not found. Install Node.js and reopen this window.
  goto :fail
)

cd /d "%SITE%"

if not exist "node_modules" (
  echo.
  echo Installing dependencies. This only happens once.
  call npm install
  if errorlevel 1 goto :fail
)

REM ------------------------------------------------------------ clear old one
REM Kill whatever already holds the port so double-clicking twice cannot end in
REM a port conflict. /T also takes the wrangler workers it started.
set BUSY_PID=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do set BUSY_PID=%%p
if defined BUSY_PID (
  echo Stopping previous server on port %PORT% ^(PID %BUSY_PID%^).
  taskkill /PID %BUSY_PID% /T /F >nul 2>&1
)

REM Give the port a moment to free. ping rather than timeout, because timeout
REM fails when this window's stdin is not a real console.
ping -n 2 127.0.0.1 >nul 2>&1

REM --------------------------------------------------------------------- run
echo.
echo === Pandawan website ===
echo Opening http://127.0.0.1:%PORT%/
echo Press Ctrl+C to stop, or just close this window.
echo.

REM Open the browser once the server answers instead of after a fixed delay, so
REM the tab does not land on a connection error on a slow start. The probe is
REM GATED (if not errorlevel 1) and the exit is inside it: chaining both with a
REM bare & threw the probe result away, opened the tab on the first iteration and
REM then exited, so the loop never actually retried.
start "website browser" /min cmd /c ^
  "for /l %%n in (1,1,60) do @(ping -n 2 127.0.0.1 >nul & netstat -ano ^| findstr :%PORT% ^| findstr LISTENING >nul & if not errorlevel 1 (start "" http://127.0.0.1:%PORT% & exit /b))"

call npm run dev

echo.
echo Website stopped.
goto :done

REM ------------------------------------------------------------------ stop
:stop
echo.
echo === Stopping website ===
set BUSY_PID=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do set BUSY_PID=%%p
if defined BUSY_PID (
  echo Stopping PID %BUSY_PID%...
  taskkill /PID %BUSY_PID% /T /F >nul 2>&1
) else (
  echo Nothing is listening on port %PORT%.
)
goto :done

:fail
echo.
echo Could not start. See the messages above.

:done
endlocal & set "PATH=%PATH%"
cmd /k
