@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install Node.js from https://nodejs.org/ then run this again.
  pause
  exit /b 1
)

set "DB_NAME=novelai-tag-community"
echo ============================================================
echo  Apply community engagement D1 migrations to production
echo  Database: %DB_NAME%
echo  This does not deploy site code or change Pages bindings.
echo ============================================================
echo.
choice /c YN /n /m "Continue with REMOTE migration? [Y/N] "
if errorlevel 2 exit /b 0

call npx --yes wrangler@4 d1 migrations apply "%DB_NAME%" --remote --config wrangler.likes.jsonc
if errorlevel 1 (
  echo.
  echo [ERROR] Remote migration failed. Check Wrangler login and database name.
  pause
  exit /b 1
)

echo.
echo Remote D1 migrations completed successfully.
pause
