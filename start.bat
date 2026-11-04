@echo off
chcp 65001 >nul
title CyberShield server
cd /d "%~dp0"
echo Ctrl+C - stop server
python server.py
echo.
echo Server stopped.
pause
