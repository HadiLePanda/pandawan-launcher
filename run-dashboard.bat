@echo off
REM Open the Pandawan dashboard in your browser.
REM
REM Double-click this file. Like run-launcher.bat, this window runs the server
REM in the foreground, so closing the window stops it.
REM
REM   run-dashboard.bat           start it, or start it fresh
REM   run-dashboard.bat stop      stop one left running from an earlier session
REM
REM Any dashboard already holding the port is stopped first, so double-clicking
REM twice does not end in EADDRINUSE.
REM
REM The dashboard is a local tool: it publishes releases to R2 and can delete
REM builds. It binds 127.0.0.1 and rejects non-local Host headers. Do not expose it.

setlocal
cd /d "%~dp0"
set PORT=4400

if /i "%~1"=="stop" goto :stop

REM ---------------------------------------------------------------- preflight
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: node not found. Install Node.js and reopen this window.
  goto :fail
)

REM Resolves the AWS CLI, which publishing needs.
call "%~dp0scripts\dev-env.bat"
where aws >nul 2>nul
if errorlevel 1 (
  echo.
  echo WARNING: aws CLI not found. Publishing will fail.
  echo          Install with: winget install Amazon.AWSCLI
  echo.
)

if not exist ".env" (
  echo.
  echo WARNING: .env not found. Copy .env.example to .env before publishing.
  echo.
)

REM ------------------------------------------------------- clear old instance
REM Kill whatever already holds the port, so double-clicking twice does not end
REM in EADDRINUSE. /T also takes the publish scripts a running dashboard may
REM have spawned, which can otherwise outlive it.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo Stopping previous dashboard on port %PORT% ^(PID %%p^).
  taskkill /PID %%p /T /F >nul 2>&1
)

REM Give the port a moment to free. ping rather than timeout, because timeout
REM fails when this window's stdin is not a real console.
ping -n 2 127.0.0.1 >nul 2>&1

REM ------------------------------------------------------------------- run
echo.
echo === Pandawan dashboard ===
echo Opening http://127.0.0.1:%PORT%/
echo Press Ctrl+C to stop, or just close this window.
echo.

REM Open the browser once the server answers rather than after a fixed delay: a
REM sleep races the startup on a slow machine and lands on a connection error.
REM This runs alongside the server in a window that closes itself when done.
start "dashboard browser" /min cmd /c ^
  "for /l %%n in (1,1,60) do @(ping -n 2 127.0.0.1 >nul ^& netstat -ano ^| findstr :%PORT% ^| findstr LISTENING >nul ^& start "" http://127.0.0.1:%PORT% ^& exit /b)"

REM Run node in this window, in the foreground, exactly as run-launcher.bat runs the
REM launcher. That is what makes closing the window stop the server: node is a
REM child of this console. An earlier version shelled out through npm, putting
REM four processes between the window and the server, so closing the window left
REM one running with nothing on screen and still holding the port.
node scripts\dashboard.mjs --port %PORT%

echo.
echo Dashboard stopped.
goto :done

REM ------------------------------------------------------------------ stop
:stop
echo.
echo === Stopping dashboard ===
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo Stopping PID %%p...
  taskkill /PID %%p /T /F >nul 2>&1
)
echo Done.
goto :done

:fail
echo.
echo Could not start. See the messages above.

:done
echo.
pause
endlocal