@echo off
REM Open the local publishing dashboard in a browser.
REM
REM Double-click this file. Output is mirrored to dashboard.log so a failed run
REM can still be read after the window closes. The window stays open while the
REM dashboard runs, and again afterwards so any error is readable.
REM
REM   run-dashboard.bat          start the dashboard (default)
REM   run-dashboard.bat stop     stop a dashboard started earlier
REM   run-dashboard.bat restart  stop, then start
REM
REM The dashboard is a local tool only: it publishes releases to R2 and can
REM delete builds, and it binds 127.0.0.1 while rejecting any non-local Host
REM header. Do not expose it.
REM
REM Stopping: press Ctrl+C, or close this window, then run the `stop` argument if
REM anything is left behind. See the PORT NOTE below for why that is still needed.

setlocal enabledelayedexpansion
cd /d "%~dp0"
set LOG=%CD%\dashboard.log
set PIDFILE=%CD%\dashboard.pid
set PORT=4400
set ACTION=%~1
if "%ACTION%"=="" set ACTION=start

REM ------------------------------------------------------------------ stop
if /i "%ACTION%"=="stop" goto :stop
if /i "%ACTION%"=="restart" (
  call :stop_quiet
  goto :start
)
goto :start

:stop
echo.
echo === Stopping dashboard ===
call :stop_quiet
echo Done.
goto :done

REM ------------------------------------------------------------------ start
:start
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

REM A dashboard from an earlier run may still be holding the port. Clear it
REM rather than failing with a bare EADDRINUSE the user has to decode. Note the
REM absence of parentheses in the messages: unescaped "(" inside a parenthesised
REM block makes cmd fail to parse the whole script.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo.
  echo A dashboard is already listening on port %PORT%, PID %%p.
  echo Stopping it and starting fresh.
  taskkill /PID %%p /T /F >nul 2>&1
  REM Give the port a moment to free before rebinding. `timeout` needs a real
  REM console and errors under redirected stdin, so ping is the portable
  REM one-second delay here.
  ping -n 2 127.0.0.1 >nul 2>&1
)

REM ------------------------------------------------------------------- run
echo Starting dashboard. Press Ctrl+C or close this window to stop.
echo.

REM Run node DIRECTLY rather than through `npm run dashboard`.
REM PORT NOTE: the earlier version went powershell -> cmd -> npm -> cmd -> node.
REM Each of those is a separate process, and closing this console window only
REM kills the outermost one - the inner chain survived and kept holding the
REM port with nothing on screen.
REM
REM -NoNewWindow is essential, not cosmetic. Without it Start-Process gives node
REM a console of its own, so closing this window leaves it running and still
REM holding the port: the exact orphan this is meant to prevent. Sharing our
REM console means the window takes node down with it.
REM
REM -PassThru is how the PID is captured: `start` does not report one, and the
REM PID file is what makes `run-dashboard.bat stop` work.
powershell -NoProfile -Command ^
  "$p = Start-Process -FilePath 'node' -ArgumentList 'scripts/dashboard.mjs','--port','%PORT%' -WorkingDirectory '%CD%' -PassThru -NoNewWindow -RedirectStandardOutput '%LOG%' -RedirectStandardError '%LOG%.err'; Set-Content -Path '%PIDFILE%' -Value $p.Id"

REM Wait for the listener rather than sleeping a fixed amount. The old version
set SAVEDPID=
for /f "usebackq delims=" %%p in ("%PIDFILE%") do set SAVEDPID=%%p
if not defined SAVEDPID (
  echo.
  echo ERROR: the dashboard process did not start. See %LOG%.err
  goto :fail
)

REM Wait for the listener rather than sleeping a fixed amount. The old version
REM opened the browser after 2s, which is a race on a slow machine: the tab can
REM load before the bind and show a connection error.
REM
REM The polling runs in PowerShell rather than a cmd loop because `timeout`
REM needs a real console. With stdin redirected it fails with "input
REM redirection is not supported" on every iteration, so the loop reported a
REM timeout and printed 20 errors while the dashboard was in fact serving. A TCP
REM connect probe in PowerShell has neither problem.
powershell -NoProfile -Command ^
  "$ok = $false; for ($i = 0; $i -lt 40; $i++) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', %PORT%); $c.Close(); $ok = $true; break } catch { Start-Sleep -Milliseconds 500 } }; if ($ok) { 'ready' } else { 'timeout' }" > "%TEMP%\dash-wait.txt" 2>&1

set /a READY=0
for /f "usebackq delims=" %%r in ("%TEMP%\dash-wait.txt") do (
  if /i "%%r"=="ready" set /a READY=1
)
del /q "%TEMP%\dash-wait.txt" >nul 2>&1

if "!READY!"=="0" goto :wait_timeout

:open_browser
echo Listening. Opening http://127.0.0.1:%PORT%/
REM `start` with a URL exits as soon as the browser is handed the tab, so it
REM leaves nothing behind holding the port.
start "" "http://127.0.0.1:%PORT%"
echo Press Ctrl+C or close this window to stop.
echo.

REM Block until node exits, then remove the PID file so a later `stop` does not
REM report a process that is already gone. WaitForExit is used rather than
REM polling tasklist, for the same stdin reason as above.
powershell -NoProfile -Command ^
  "try { Wait-Process -Id %SAVEDPID% -ErrorAction Stop } catch {}; Remove-Item -LiteralPath '%PIDFILE%' -Force -ErrorAction SilentlyContinue"

echo.
echo Dashboard stopped. Output: %LOG%
if exist "%LOG%.err" (
  for %%f in ("%LOG%.err") do if %%~zf GTR 0 (
    echo.
    echo Errors were written to %LOG%.err
  )
)
goto :done

:wait_timeout
echo.
echo WARNING: the dashboard did not answer on port %PORT%. See %LOG% and %LOG%.err
goto :done

REM ------------------------------------------------------------------- stop
REM Read the recorded PID and kill its whole tree. /T matters: the dashboard
REM spawns the publish scripts it runs, and killing only the parent can leave
REM those holding a handle.
:stop_quiet
if not exist "%PIDFILE%" goto :stop_by_port

set SAVEDPID=
for /f "usebackq delims=" %%p in ("%PIDFILE%") do set SAVEDPID=%%p
if not defined SAVEDPID goto :stop_by_port

tasklist /FI "PID eq %SAVEDPID%" 2>nul | find "%SAVEDPID%" >nul
if errorlevel 1 (
  echo No dashboard is running ^(PID %SAVEDPID% is gone^).
  del /q "%PIDFILE%" >nul 2>&1
  goto :eof
)

echo Stopping dashboard ^(PID %SAVEDPID%)...
taskkill /PID %SAVEDPID% /T /F >nul 2>&1
del /q "%PIDFILE%" >nul 2>&1
goto :eof

REM No PID file, so fall back to whatever holds the port. /T again, for the
REM publish scripts a running dashboard may have spawned.
:stop_by_port
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo Stopping process %%p on port %PORT%...
  taskkill /PID %%p /T /F >nul 2>&1
)
goto :eof

REM ------------------------------------------------------------------- done
:fail
echo.
echo Could not start. See the messages above.

:done
echo.
pause
endlocal