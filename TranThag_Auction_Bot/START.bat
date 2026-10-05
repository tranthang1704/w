@echo off
title TranThag TikTok Auction Bot
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
if not exist node_modules call npm install
echo.
echo Browser Source: http://localhost:3000/widget.html
echo.
call npm start
pause
