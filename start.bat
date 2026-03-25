@echo off
chcp 65001 >nul

REM Kill existing process on port 3456
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456 " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)

cd /d %~dp0

REM Open browser after 2 seconds (background)
start /B cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3456"

REM Start server in foreground
node server/index.js
pause
