@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

REM --- find Python: prefer the 'py' launcher, then 'python' ---
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY ( where python >nul 2>nul && set "PY=python" )
if not defined PY (
  echo [ERROR] Python not found.
  echo Install Python 3 from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during setup, then re-run this file.
  pause
  exit /b 1
)

REM --- make sure python-docx is installed (auto-fix if missing) ---
%PY% -c "import docx" 2>nul
if errorlevel 1 (
  echo == Installing dependencies ^(python-docx, Pillow^) ==
  %PY% -m pip install -r requirements.txt
)

echo == Converting codex .docx files ==
%PY% tools\convert.py
if errorlevel 1 (
  echo.
  echo [FAILED] Conversion error - please send the message above to fix it.
  pause
  exit /b 1
)

echo.
echo [DONE] Data written to site\data\
pause
exit /b 0
