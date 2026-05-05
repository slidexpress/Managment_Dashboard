@echo off
title Slidexpress Project Tracker
color 0A
echo.
echo  ==========================================
echo    Slidexpress Project Tracker
echo  ==========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo  [ERROR] Node.js is not installed!
  echo.
  echo  Please install Node.js from: https://nodejs.org
  echo  Download the LTS version, install it, then run this file again.
  echo.
  pause
  exit
)

if not exist "node_modules" (
  echo  Installing dependencies for first time...
  echo  This will only happen once.
  echo.
  npm install
  echo.
)

echo  Starting server...
echo  Open your browser to: http://localhost:3000
echo.
echo  Default Login:
echo    Email:    admin@mecstudio.com
echo    Password: admin123
echo.
echo  To access from other PCs on same network,
echo  use this PC's IP address instead of localhost.
echo.
echo  Press Ctrl+C to stop the server.
echo  ==========================================
echo.
node server.js
pause
