@echo off
REM Build the launcher into an installable bundle, signed with the local
REM minisign key so clients can verify updates.
REM
REM Double-click this file. Output is mirrored to build-launch.log.
REM
REM Output lands in:
REM   src-tauri\target\release\bundle\
REM
REM This produces a self-contained installer you can share. It does NOT publish
REM anything to R2 - that happens in CI when you tag a release. Run
REM `npm run release` for that.

setlocal enabledelayedexpansion
cd /d "%~dp0"
set LOG=%CD%\build-launch.log

echo.
echo === Pandawan Launcher - signed build ===
echo Log: %LOG%
echo This takes several minutes.
echo.

REM Resolves cargo / aws / minisign even when this window was started before
REM those were installed. See scripts\dev-env.bat for why that is needed.
call "%~dp0scripts\dev-env.bat"

where cargo >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: cargo not found.
  echo        Install Rust from https://rustup.rs and reopen this window.
  goto :preflight_failed
)

call npm run --silent keys:check
if errorlevel 1 goto :preflight_failed

call npm run tauri:build > "%LOG%" 2>&1
if errorlevel 1 goto :build_failed

echo.
echo Build finished. Installers:
dir /b "%CD%\src-tauri\target\release\bundle"
echo.
goto :done

:preflight_failed
echo.
echo Pre-flight check failed. See the messages above.
goto :done

:build_failed
echo.
echo Build failed. Last lines:
powershell -NoProfile -Command "Get-Content -Tail 25 '%LOG%'"
goto :done

:done
echo.
echo Full output: %LOG%
REM Leave a live prompt here instead of a "press a key to continue" nag: the
REM last command is one up-arrow away, and a failure stays on screen to be read
REM and retried. `endlocal & set` re-exports the PATH dev-env.bat added, which a
REM bare endlocal would discard and leave cargo/aws off PATH in the new shell.
endlocal & set "PATH=%PATH%"
cmd /k