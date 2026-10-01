@echo off
REM Add the toolchain directories this project needs to PATH for this session.
REM
REM Windows only refreshes PATH for newly started processes after a logoff, so a
REM double-clicked .bat launched from a desktop that was already running can miss
REM tools that are installed and present in the user PATH. Appending the known
REM install locations here makes the launchers work without asking anyone to log
REM off and on. Anything already on PATH is left alone.
REM
REM Call this before using cargo, aws, or minisign. Not intended to be run
REM directly.
REM
REM Opened directly it has no output and no pause, so the window flashes and
REM closes and it looks like it failed even though it did its job.
REM
REM %0 is quoted when this runs under `call` from a launcher and unquoted when
REM cmd was launched to run it directly. That is the discriminator: a double
REM click and a `call` both pass no arguments, and %cmdcmdline% is non-empty in
REM both cases, so neither of those can tell the two situations apart.

@echo off
if "%~0"=="%0" goto :direct_launch

setlocal
if not defined USERPROFILE set USERPROFILE=%SystemDrive%\Users\%USERNAME%
if not defined LOCALAPPDATA set LOCALAPPDATA=%USERPROFILE%\AppData\Local

REM --- Rust toolchain ---
where cargo >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
    set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
  )
)

REM --- AWS CLI (used to publish game builds to R2) ---
where aws >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\Amazon\AWSCLIV2\aws.exe" (
    set "PATH=C:\Program Files\Amazon\AWSCLIV2;%PATH%"
  )
)

REM --- minisign (signs launcher updates) ---
REM winget scatters the binary under a versioned package folder, so match it by
REM glob rather than hard-coding a path that changes on every update.
where minisign >nul 2>nul
if errorlevel 1 (
  for /d %%d in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\jedisct1.minisign_*") do (
    if exist "%%d\minisign-win64\x86_64" set "PATH=%%d\minisign-win64\x86_64;%PATH%"
  )
)

endlocal & set "PATH=%PATH%"

goto :eof

REM Reached only by double-clicking this file. Say so, rather than flashing
REM closed and leaving the user to assume it broke.
:direct_launch
echo.
echo dev-env.bat
echo.
echo This file only adjusts PATH for the launchers that call it. It has nothing
echo to show on its own, so opening it directly appears to do nothing.
echo.
echo It is called automatically by:
echo    run-dashboard.bat
echo    run-dev.bat
echo    build-installer.bat
echo.
echo Close this window, or press a key.
echo.
pause