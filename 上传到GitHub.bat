@echo off
setlocal EnableExtensions EnableDelayedExpansion
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

REM ---------------------------------------------------------------
REM  Step 3: export + commit + push, capture output
REM ---------------------------------------------------------------
echo [i] Exporting database and pushing to GitHub, please wait...
echo.

set "OUTFILE=%TEMP%\df_publish_out.txt"
%PY% "%~dp0publish.py" > "%OUTFILE%" 2>&1
set "RC=%ERRORLEVEL%"

REM show what publish.py said
type "%OUTFILE%"
echo.

REM read the status line publish.py printed
set "STAT=unknown"
for /f "tokens=2 delims==" %%A in ('findstr /b "PUBLISH_STATUS=" "%OUTFILE%"') do set "STAT=%%A"

if "%RC%"=="0" goto :ok
goto :failed

:ok
echo ===================================================================
if "%STAT%"=="pushed" goto :ok_pushed
if "%STAT%"=="no_change" goto :ok_nochange
goto :ok_pushed

:ok_pushed
echo    SUCCESS - uploaded to GitHub
echo ===================================================================
echo.
echo    EdgeOne rebuilds automatically (about 1-2 minutes).
echo    Then refresh your site link and the new codes are there.
echo.
goto :end_ok

:ok_nochange
echo    NOTHING TO UPLOAD
echo ===================================================================
echo.
echo    Your database matches what is already on GitHub.
echo    If you just added data in the admin page, check that:
echo      - the entries are saved (click Save in the admin table)
echo      - their status is "published", not draft
echo.
goto :end_ok

:end_ok
pause
endlocal
exit /b 0

:failed
echo ===================================================================
echo    FAILED  (exit code %RC%)
echo ===================================================================
echo.
echo    Common causes and fixes:
echo.
echo    1. Network cannot reach github.com
echo       - Check internet, then run this file again.
echo       - Your database is NOT changed, retrying is safe.
echo       - If you use a proxy, git needs it too. Run once:
echo           git config --global http.proxy http://127.0.0.1:7897
echo.
echo    2. Git not logged in
echo       - Run once in a terminal:  git push origin main
echo       - A browser window appears; sign in one time.
echo.
echo    3. No remote configured
echo       - Run:  git remote add origin ^<your repo URL^>
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
echo     That is your database. Add data first:
echo       1. Double click start.bat
echo       2. Open http://127.0.0.1:8000/admin
echo.
pause
endlocal
exit /b 1

:no_script
echo [X] Cannot find publish.py
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
