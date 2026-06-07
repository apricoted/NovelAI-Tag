@echo off
chcp 65001 >nul
cd /d %~dp0
echo == Publishing updates to GitHub (Cloudflare will auto-deploy) ==
git add -A
git commit -m "更新站点数据和图片"
git push
echo.
echo Done. The live site updates in ~1 minute.
pause
