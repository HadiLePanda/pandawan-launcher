@echo off
REM Compile the launcher once, then run it. No hot reload.
REM
REM Use run-launcher.bat for day-to-day work: it reuses the debug build and starts in
REM seconds. This builds the same debug profile but launches it detached so the
REM launcher survives this window closing, which is what you want when testing
REM as a user would - no devtools, no vite server, real window behaviour.
REM
REM To produce a shareable installer instead, use build-installer.bat.

setlocal enabledelayedexpansion
cd /d "%~dp0"
set LOG=%CD%\build-and-run.log
set EXE=%CD%\src-tauri\target\debug\pandawan-launcher.exe

echo.
echo === Pandawan Launcher - compile and run ===
echo Log: %LOG%
echo.

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

REM ------------------------------------------------------------------- build
REM `tauri build --debug --no-bundle` compiles the same debug profile as dev but
REM exits when done, leaving target\debug\pandawan-launcher.exe behind. Using
REM `tauri dev` here would never return: it stays alive hosting the vite server.
echo Building debug launcher (first build takes several minutes)...
call npm run --silent sync:updater-key
if errorlevel 1 goto :fail
REM Merge stderr into stdout inside cmd, before PowerShell sees the output. PowerShell
REM wraps a native command's stderr in NativeCommandError records, which flood the
REM window with red noise for output that is normal (cargo progress bars).
powershell -NoProfile -Command "& { cmd /c 'npm exec -- tauri build --debug --no-bundle 2>&1' | Tee-Object -FilePath '%LOG%' }"
REM Tee-Object defaults to UTF-16, which findstr refuses to read and which makes
REM the log awkward to open in an editor. Re-encode it to UTF-8.
powershell -NoProfile -Command "Get-Content '%LOG%' | Set-Content '%LOG%.utf8' -Encoding utf8"
move /y "%LOG%.utf8" "%LOG%" >nul 2>nul

REM Read success off the build log rather than off errorlevel: PowerShell does not
REM propagate the inner command's exit code through a pipeline.
findstr /C:"Finished" "%LOG%" >nul 2>nul
if errorlevel 1 goto :fail

if not exist "%EXE%" (
  echo.
  echo ERROR: build finished but %EXE% is missing.
  echo        See %LOG%
  goto :fail
)

REM --------------------------------------------------------------------- run
REM `start` detaches it so it outlives this window and vite is not involved.
echo.
echo Launching...
start "" "%EXE%"

echo.
echo Launcher started. It runs independently of this window.
echo Close it from the taskbar when you're done.
goto :done

:fail
echo.
echo Could not start. See the messages above.

:done
echo.
REM Leave a live prompt here instead of a "press a key to continue" nag: the
REM last command is one up-arrow away, and a failure stays on screen to be read
REM and retried. `endlocal & set` re-exports the PATH dev-env.bat added, which a
REM bare endlocal would discard and leave cargo/aws off PATH in the new shell.
endlocal & set "PATH=%PATH%"
cmd /k