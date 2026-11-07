@echo off
setlocal
cd /d "%~dp0..\.."
set "PATH=C:\Program Files\nodejs;%PATH%"
if not exist logs mkdir logs
:loop
echo [%date% %time%] arrancando erp-daemon >> logs\erp-sync.log
node scripts-agent\erp\erp-daemon.mjs >> logs\erp-sync.log 2>&1
echo [%date% %time%] erp-daemon termino (exit %errorlevel%); reintento en 10s >> logs\erp-sync.log
timeout /t 10 /nobreak >nul
goto loop
