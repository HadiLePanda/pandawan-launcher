@echo off
REM Launch the launcher in dev mode (hot reload).
REM
REM Double-click this file. Output is mirrored to dev-launch.log so a failed
REM run can still be read after the window closes.
REM
REM The window stays open on exit so any error is readable. Close with Ctrl+C,
REM or press a key when it stops.

setlocal enabledelayedexpansion
cd /d "%~dp0"
set LOG=%CD%\dev-launch.log

echo.
echo === Pandawan Launcher - dev mode ===
echo Log: %LOG%
echo.

REM ---------------------------------------------------------------- toolchain
REM Resolves cargo / aws / minisign even when this window was started before
REM those were installed. See scripts\dev-env.bat for why that is needed.
call "%~dp0scripts\dev-env.bat"

where cargo >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: cargo not found.
  echo        Install Rust from https://rustup.rs and reopen this window.
  goto :fail
)

REM ---------------------------------------------------------------- preflight
call npm run --silent keys:check
if errorlevel 1 goto :preflight_failed

if not exist ".env" (
  echo WARNING: .env not found. Copy .env.example to .env to publish games.
)

where aws >nul 2>nul
if errorlevel 1 (
  echo WARNING: aws CLI not found. Game publishing will fail.
  echo          Install with: winget install Amazon.AWSCLI
)

REM A stale instance from an earlier run holds port 1420. Vite runs with
REM strictPort, so it exits immediately and takes this window with it.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":1420" ^| findstr "LISTENING"') do (
  echo.
  echo ERROR: port 1420 is already in use by PID %%p.
  echo        A previous dev run is probably still going.
  echo        Close it with:  taskkill /PID %%p /F
  goto :fail
)

REM ------------------------------------------------------------------- run
echo.
echo Starting dev launcher...
call npm run tauri:dev > "%LOG%" 2>&1

REM `npm run tauri:dev` is normally long-lived. Reaching here means it stopped.
type "%LOG%"
echo.
echo Dev launcher stopped. Full output: %LOG%
goto :done

:preflight_failed
echo.
echo Pre-flight check failed. See the messages above.
goto :done

:fail
echo.
echo Could not start. See the messages above.

:done
echo.
pause
endlocal