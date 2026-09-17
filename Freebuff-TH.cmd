@echo off
chcp 65001 >nul
setlocal
title Freebuff (TH)

set "DIR=%~dp0"
set "APP=%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop\Freebuff.exe"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] ไม่พบ Node.js - ต้องติดตั้ง Node.js ก่อนจึงใช้ตัวเรียกนี้ได้
  echo     ดาวน์โหลด: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "%APP%" (
  echo [!] ไม่พบแอพ Freebuff ที่ %APP%
  pause
  exit /b 1
)

echo กำลังตรวจและซิงค์การแปลไทย...
node "%DIR%fbth\fbth.js" ensure

echo กำลังเปิด Freebuff...
start "" "%APP%"
endlocal
