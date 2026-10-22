@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul 2>&1

REM ===================================================================
REM   Delta Force Gun Codes - one click launcher
REM   Double click this file. Closing this window stops the website.
REM
REM   NOTE: this file is intentionally ASCII-only. Chinese text inside
REM   a .bat gets mangled by the GBK codepage on Chinese Windows and
REM   breaks parsing. All Chinese messages come from server.py.
REM ===================================================================

set "PORT=8000"
set "HOST=0.0.0.0"

title Gun Codes Server - port %PORT%

echo.
echo ===================================================================
echo    Delta Force Gun Codes
echo ===================================================================
echo.

REM ---------------------------------------------------------------
REM  Step 1: locate a working Python
REM ---------------------------------------------------------------
set "PY="

py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=py -3"

if not defined PY (
    python -c "import sys" >nul 2>&1
    if not errorlevel 1 set "PY=python"
)

if not defined PY (
    for %%P in (
        "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe"
        "%LOCALAPPDATA%\Python\pythoncore-3.13-64\python.exe"
        "%LOCALAPPDATA%\Python\pythoncore-3.12-64\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
        "C:\Python312\python.exe"
        "C:\Python311\python.exe"
    ) do (
        if not defined PY (
            if exist %%P %%P -c "import sys" >nul 2>&1 && set "PY=%%~P"
        )
    )
)

if not defined PY goto :no_python

echo [OK] Python: %PY%

%PY% -c "import sqlite3" >nul 2>&1
if errorlevel 1 goto :no_sqlite

REM ---------------------------------------------------------------
REM  Step 2: is the port already in use?
REM ---------------------------------------------------------------
%PY% -c "import socket,sys; s=socket.socket(); s.settimeout(0.4); sys.exit(0 if s.connect_ex(('127.0.0.1',%PORT%))==0 else 1)" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [!] Port %PORT% is already in use - server may already be running.
    echo.
    choice /c YN /n /m "     Open the existing one? [Y = open / N = start another] "
    if errorlevel 2 goto :do_start
    start "" "http://127.0.0.1:%PORT%/"
    exit /b 0
)

:do_start
if not exist "data\.admin-password" (
    echo.
    echo [i] First run: database and admin password will be created now.
    echo.
)

echo [i] Starting server, browser opens in 2 seconds...
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%PORT%/'"

echo.
%PY% "%~dp0server.py" --host %HOST% --port %PORT%

echo.
echo ===================================================================
echo    Server stopped.
echo ===================================================================
echo.
pause
endlocal
exit /b 0

:no_python
echo [X] Python not found.
echo.
echo     Install Python 3.8+ from https://www.python.org/downloads/
echo     IMPORTANT: check "Add Python to PATH" during installation.
echo.
pause
endlocal
exit /b 1

:no_sqlite
echo [X] This Python has no sqlite3 module. Please reinstall official Python.
echo.
pause
endlocal
exit /b 1
