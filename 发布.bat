@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo Git not found. Please install Git for Windows first.
  pause
  exit /b 1
)

echo == Publishing updates to GitHub - Cloudflare will auto-deploy ==
call git add -A
if errorlevel 1 goto :fail

call git diff --cached --quiet
if errorlevel 1 (
  call git commit -m "更新站点数据和图片"
  if errorlevel 1 goto :fail
) else (
  echo No local changes to commit.
)

call git push
if errorlevel 1 goto :fail

echo.
echo Done. The live site updates in ~1 minute.
pause
exit /b 0

:fail
echo.
echo Publish failed. Please check the message above.
pause
exit /b 1
