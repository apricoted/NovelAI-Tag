@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

REM --- find Python: prefer python, then the py launcher ---
set "PY="
python --version >nul 2>nul
if not errorlevel 1 set "PY=python"
if not defined PY (
  py -3 --version >nul 2>nul
  if not errorlevel 1 set "PY=py -3"
)
if not defined PY (
  echo [ERROR] Python not found.
  echo Install Python 3 from https://www.python.org/downloads/ ^(tick "Add to PATH"^).
  pause
  exit /b 1
)

if not exist r2_config.json (
  echo [ERROR] Missing r2_config.json
  echo Copy r2_config.example.json to r2_config.json and fill in your R2 keys.
  pause
  exit /b 1
)

call %PY% tools\sync_r2.py %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo [WARN] R2 sync finished with code %RC%.
) else (
  echo [DONE] R2 sync complete.
)
pause
exit /b %RC%
