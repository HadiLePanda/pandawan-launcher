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

setlocal
cd /d "%~dp0"
set LOG=%CD%\build-launch.log

echo.
echo === Pandawan Launcher - signed build ===
echo Log: %LOG%
echo This takes several minutes.
echo.

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
pause
endlocal