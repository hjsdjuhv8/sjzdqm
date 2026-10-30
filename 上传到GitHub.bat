@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul 2>&1

REM ===================================================================
REM   One-click upload to GitHub
REM   Double click this file. It exports your database and pushes.
REM
REM   NOTE: ASCII only on purpose. Chinese text inside a .bat gets
REM   mangled by the GBK codepage and breaks parsing.
REM   All Chinese messages come from publish.py instead.
REM ===================================================================

title Upload to GitHub

echo.
echo ===================================================================
echo    Upload Gun Codes to GitHub
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
echo.

REM ---------------------------------------------------------------
REM  Step 2: sanity checks
REM ---------------------------------------------------------------
if not exist "data\codes.db" goto :no_db
if not exist "publish.py" goto :no_script

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto :no_git

echo [i] Exporting database and pushing to GitHub, please wait...
echo.

REM ---------------------------------------------------------------
REM  Step 3: export + commit + push
REM ---------------------------------------------------------------
%PY% "%~dp0publish.py"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" goto :ok
goto :failed

:ok
echo ===================================================================
echo    SUCCESS
echo ===================================================================
echo.
echo    Data is on GitHub now.
echo    EdgeOne will rebuild automatically (about 1-2 minutes).
echo    Then your link shows the new data.
echo.
pause
endlocal
exit /b 0

:failed
echo ===================================================================
echo    FAILED  (exit code %RC%)
echo ===================================================================
echo.
echo    Common causes:
echo.
echo    1. Network cannot reach github.com
echo       - Check your internet, or wait and retry.
echo       - If you use a VPN/proxy, try turning it off or on.
echo.
echo    2. Git not logged in
echo       - Run this once in a terminal:
echo           git push origin main
echo       - A browser login window will pop up. Sign in once.
echo.
echo    3. No remote configured
echo       - Run: git remote add origin ^<your repo URL^>
echo.
echo    Your local database was NOT changed. Just retry after fixing.
echo.
pause
endlocal
exit /b 1

:no_python
echo [X] Python not found.
echo.
echo     Install Python 3.8+ from https://www.python.org/downloads/
echo     IMPORTANT: check "Add Python to PATH" during installation.
echo.
pause
endlocal
exit /b 1

:no_db
echo [X] Cannot find data\codes.db
echo.
echo     That is your database. Open the admin page first and add data:
echo       1. Double click start.bat
echo       2. Open http://127.0.0.1:8000/admin
echo.
pause
endlocal
exit /b 1

:no_script
echo [X] Cannot find publish.py
echo.
echo     Make sure this .bat file sits next to publish.py.
echo.
pause
endlocal
exit /b 1

:no_git
echo [X] This folder is not a git repository.
echo.
echo     Run these once in a terminal:
echo         git init
echo         git remote add origin ^<your repo URL^>
echo         git add -A
echo         git commit -m "init"
echo.
pause
endlocal
exit /b 1
