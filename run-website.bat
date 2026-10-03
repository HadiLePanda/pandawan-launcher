@echo off
REM Shortcut to the website runner, kept here so every runner sits together:
REM
REM   run-launcher.bat    the launcher app
REM   run-dashboard.bat   the publishing dashboard
REM   run-website.bat     this file, the public download page
REM
REM The website lives in the sibling folder pandawan-launcher-site, which has its
REM own run-website.bat. This just hands over to it, so there is one copy of the
REM logic and one place to change it.

setlocal
set SITE=%~dp0..\pandawan-launcher-site

if not exist "%SITE%\run-website.bat" (
  echo.
  echo ERROR: %SITE%\run-website.bat not found.
  echo        The website is expected in the sibling folder pandawan-launcher-site.
  goto :fail
)

call "%SITE%\run-website.bat" %*
goto :done

:fail
echo.
echo Could not start. See the message above.

:done
endlocal
