@echo off
setlocal
REM Starts the local PHP dev server for the Sri Yantra Explorer.
REM Usage:  start.bat [port]      default: first free port of 8080 8000 8888
REM Close this window (or press Ctrl+C) to stop the server.

REM Always serve the folder this .bat lives in, wherever it was launched from.
cd /d "%~dp0"

where php >nul 2>&1
if errorlevel 1 (
    echo PHP was not found on your PATH.
    echo Install PHP ^(e.g. Laravel Herd^) or add it to PATH, then run this again.
    pause
    exit /b 1
)

if not "%~1"=="" (
    set "CANDIDATES=%~1"
) else (
    set "CANDIDATES=8080 8000 8888"
)

REM Windows (Hyper-V / WSL) reserves whole port ranges; pick the first one that binds.
set "PORT="
for %%p in (%CANDIDATES%) do (
    if not defined PORT (
        powershell -NoProfile -Command "try { $l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,%%p); $l.Start(); $l.Stop(); exit 0 } catch { exit 1 }"
        if not errorlevel 1 set "PORT=%%p"
    )
)

if not defined PORT (
    echo Could not open any of these ports: %CANDIDATES%
    echo Windows reserves some port ranges for Hyper-V / WSL. To see them:
    echo     netsh interface ipv4 show excludedportrange protocol=tcp
    echo Pick a port outside those ranges:   start.bat 9000
    pause
    exit /b 1
)

echo Starting Sri Yantra Explorer at http://localhost:%PORT%
echo Editor: http://localhost:%PORT%/?edit
echo.

start "" "http://localhost:%PORT%"
php -S localhost:%PORT%