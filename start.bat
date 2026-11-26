@echo off
chcp 65001 >nul
title CyberShield
cd /d "%~dp0"
echo http://localhost:8000   (Ctrl+C - stop)
python -m http.server 8000 -d static
pause
