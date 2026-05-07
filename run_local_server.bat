@echo off
setlocal

set PORT=8097
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  set "PY_CMD=py"
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    set "PY_CMD=python"
  ) else (
    echo Python was not found.
    echo Install Python 3 and enable PATH, then run this file again.
    pause
    exit /b 1
  )
)

set CACHE_BUST=%RANDOM%%RANDOM%
echo Starting no-cache local server at http://127.0.0.1:%PORT%/
start "" "http://127.0.0.1:%PORT%/?v=%CACHE_BUST%"
%PY_CMD% tools\nocache_server.py %PORT%
