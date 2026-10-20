@echo off
rem ============================================================
rem  prod.cmd - lanzador de produccion para Windows Server.
rem
rem  En este servidor el motor Docker vive dentro de la distro WSL
rem  `Ubuntu` (no Docker Desktop). Los compose usan bind mounts
rem  (Caddyfile, init.sql), que solo resuelven con rutas Linux; por
rem  eso prod.js se ejecuta DENTRO de WSL, no con Node de Windows.
rem
rem  Uso:
rem    prod.cmd                 construye y levanta
rem    prod.cmd --no-build      levanta sin reconstruir
rem    prod.cmd --with-db       ademas levanta/conecta PostgreSQL
rem    prod.cmd --dns           muestra los registros DNS
rem    prod.cmd --status        estado del contenedor
rem    prod.cmd --logs          logs en vivo
rem    prod.cmd --stop          detiene el contenedor
rem ============================================================
setlocal

rem "%~dp0." evita que la barra final rompa el entrecomillado en cmd.
for /f "usebackq delims=" %%i in (`wsl.exe -d Ubuntu -u root -- wslpath -u "%~dp0."`) do set "WSLDIR=%%i"
if "%WSLDIR%"=="" (
  echo [prod] No se pudo resolver la ruta del proyecto en WSL. ^¿Esta instalada la distro Ubuntu?
  exit /b 1
)

wsl.exe -d Ubuntu -u root -- bash -lc "cd '%WSLDIR%' && node prod.js %*"
exit /b %ERRORLEVEL%
