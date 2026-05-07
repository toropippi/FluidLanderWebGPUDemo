@echo off
setlocal

set PORT=8098
cd /d "%~dp0..\.."

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
set URL=http://127.0.0.1:%PORT%/analysis/stage53-cip/index.html?v=%CACHE_BUST%
echo Starting Stage 5-3 CIP analysis replay at %URL%
start "" "%URL%"
%PY_CMD% tools\nocache_server.py %PORT%
