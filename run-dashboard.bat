@echo off
REM Open the local publishing dashboard in a browser.
REM
REM Double-click this file. Output is mirrored to dashboard.log so a failed run
REM can still be read after the window closes.
REM
REM The dashboard is a local tool only: it publishes releases to R2 and holds
REM signing keys, and it binds 127.0.0.1 while rejecting any non-local Host
REM header. Do not expose it. The window stays open on exit so any error is
REM readable. Close with Ctrl+C, or press a key when it stops.

setlocal enabledelayedexpansion
cd /d "%~dp0"
set LOG=%CD%\dashboard.log
set PORT=4400

echo.
echo === Pandawan publishing dashboard ===
echo Log:  %LOG%
echo URL:  http://127.0.0.1:%PORT%
echo.

REM ---------------------------------------------------------------- preflight
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: node not found. Install Node.js and reopen this window.
  goto :fail
)

REM Publishing uploads to R2 through the AWS CLI, so it has to be resolvable.
call "%~dp0scripts\dev-env.bat"
where aws >nul 2>nul
if errorlevel 1 (
  echo.
  echo WARNING: aws CLI not found. Publishing will fail.
  echo          Install with: winget install Amazon.AWSCLI
  echo.
)

REM The dashboard reads its R2 credentials from here. Without it the UI starts
REM but every publish is refused.
if not exist ".env" (
  echo.
  echo WARNING: .env not found. Copy .env.example to .env before publishing.
  echo.
)

REM A stale dashboard from an earlier run still holds the port. Reuse is safe
REM to detect but not to assume, so say which PID and stop rather than fail with
REM a bare EADDRINUSE.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo.
  echo ERROR: port %PORT% is already in use by PID %%p.
  echo        A dashboard from an earlier run is probably still open.
  echo        Close it with:  taskkill /PID %%p /F
  goto :fail
)

REM ------------------------------------------------------------------- run
echo Starting dashboard. Press Ctrl+C to stop.
echo.

REM Open the browser once the listener is actually up. --silent plus a short
REM delay avoids racing the bind: without it the tab can load before the server
REM answers and show a connection error.
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:%PORT%"

REM Merge stderr into stdout inside cmd, before PowerShell sees the output.
REM PowerShell wraps a native command's stderr in a NativeCommandError record,
REM which floods the window with red RemoteException noise for output that is
REM perfectly normal. Piping cmd's merged stream keeps stderr out of
REM PowerShell's error stream while still reaching the log.
powershell -NoProfile -Command "& { cmd /c 'npm run dashboard -- --port %PORT% 2>&1' | Tee-Object -FilePath '%LOG%' }"

REM `npm run dashboard` is normally long-lived. Reaching here means it stopped.
echo.
echo Dashboard stopped. Full output: %LOG%
goto :done

:fail
echo.
echo Could not start. See the messages above.

:done
echo.
pause
endlocal