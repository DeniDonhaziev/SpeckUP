@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SPEAKUP - сервер

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo ОШИБКА: Node.js не установлен.
  echo Скачайте Node.js LTS с https://nodejs.org/
  echo После установки снова нажмите этот файл.
  echo.
  pause
  exit /b 1
)

echo.
echo Запускаю сайт...
echo Не закрывайте это окно, пока пользуетесь сайтом.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"
node server.js

echo.
echo Сервер остановлен. Если выше есть ошибка, сфотографируйте это окно.
pause
