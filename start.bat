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

call :probe
if defined PORT goto :serve

REM Windows (Hyper-V / WSL) grabs whole port ranges through the WinNAT service and
REM nothing else can bind inside them. Restarting WinNAT releases every reservation
REM it holds; Hyper-V re-reserves what it actually needs on its next start.
echo None of these ports can be opened: %CANDIDATES%
echo Windows ^(Hyper-V / WinNAT^) has reserved them. Restarting the WinNAT service
echo releases them. This needs administrator rights - please approve the prompt.
echo.
powershell -NoProfile -Command "try { $p = Start-Process -Verb RunAs -Wait -PassThru -WindowStyle Hidden cmd.exe -ArgumentList '/c net stop winnat && net start winnat'; exit $p.ExitCode } catch { exit 1 }"
if errorlevel 1 (
    echo Could not restart WinNAT ^(prompt declined, or the service failed to restart^).
    goto :fail
)
echo WinNAT restarted. Retrying...
call :probe
if defined PORT goto :serve

:fail
echo.
echo Still could not open any of these ports: %CANDIDATES%
echo To see what Windows has reserved:
echo     netsh interface ipv4 show excludedportrange protocol=tcp
echo Pick a port outside those ranges:   start.bat 9000
pause
exit /b 1

:serve
echo Starting Sri Yantra Explorer at http://localhost:%PORT%
echo Editor: http://localhost:%PORT%/?edit
echo.

start "" "http://localhost:%PORT%"
php -S localhost:%PORT%
exit /b

:probe
REM Sets PORT to the first candidate that actually binds, or leaves it empty.
set "PORT="
for %%p in (%CANDIDATES%) do (
    if not defined PORT (
        powershell -NoProfile -Command "try { $l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,%%p); $l.Start(); $l.Stop(); exit 0 } catch { exit 1 }"
        if not errorlevel 1 set "PORT=%%p"
    )
)
exit /b
