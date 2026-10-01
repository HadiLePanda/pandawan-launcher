@echo off
REM Build the launcher into an installable bundle, signed with the local
REM minisign key so clients can verify updates.
REM
REM Output lands in:
REM   src-tauri\target\release\bundle\
REM
REM This produces a self-contained installer you can share. It does NOT publish
REM anything to R2 - that happens in CI when you tag a release. See
REM RELEASE.md / npm run release for the publishing path.

setlocal
cd /d "%~dp0"

echo Checking updater keys...
call npm run --silent keys:check
if errorlevel 1 goto :fail

echo.
echo Building signed bundle (this takes a few minutes)...
call npm run tauri:build
if errorlevel 1 goto :fail

echo.
echo Build finished. Installers are in:
echo   %CD%\src-tauri\target\release\bundle\
echo.
dir /b "%CD%\src-tauri\target\release\bundle"
goto :eof

:fail
echo.
echo Build failed. See the output above.
exit /b 1