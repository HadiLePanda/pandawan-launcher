@echo off
REM Launch the launcher in dev mode (hot reload).
REM
REM Checks the things that commonly break a dev run before starting:
REM   - updater keypair present and synced
REM   - .env has the R2 credentials the publish scripts need
REM   - AWS CLI on PATH (installed by winget install Amazon.AWSCLI)
REM
REM Ctrl+C to stop.

setlocal
cd /d "%~dp0"

echo Checking updater keys...
call npm run --silent keys:check
if errorlevel 1 goto :fail

if not exist ".env" (
  echo.
  echo WARNING: .env not found.
  echo Copy .env.example to .env and fill in your R2 credentials
  echo if you want to publish games from this machine.
  echo.
)

where aws >nul 2>nul
if errorlevel 1 (
  echo.
  echo WARNING: aws CLI not on PATH. Game publishing will fail.
  echo Install with: winget install Amazon.AWSCLI
  echo.
)

echo.
echo Starting dev launcher...
call npm run tauri:dev
goto :eof

:fail
echo.
echo Pre-flight check failed. Fix the above and try again.
exit /b 1