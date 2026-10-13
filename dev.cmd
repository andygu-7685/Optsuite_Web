@echo off
setlocal
cd /d "%~dp0" || exit /b 1

if /I "%~1"=="help" goto help
if not "%~1"=="" if /I not "%~1"=="backend" goto help

if not exist ".venv\Scripts\python.exe" (
    py -m venv .venv
    if errorlevel 1 exit /b 1
)

".venv\Scripts\python.exe" -m pip install -r requirements.txt -r backend\requirements.txt
if errorlevel 1 exit /b 1

if /I "%~1"=="backend" goto backend

if not exist "frontend\node_modules\.package-lock.json" (
    pushd frontend
    call npm install
    if errorlevel 1 (
        popd
        exit /b 1
    )
    popd
)

start "Optsuite backend" /D "%CD%" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1"
for /L %%I in (1,1,60) do (
    curl.exe --silent --fail --max-time 1 --output NUL http://127.0.0.1:8000/openapi.json
    if not errorlevel 1 goto frontend
    timeout /t 1 /nobreak >NUL
)
echo Backend did not become ready on http://127.0.0.1:8000.
exit /b 1

:frontend
pushd frontend
call npm run dev
set "result=%ERRORLEVEL%"
popd
exit /b %result%

:backend
".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
exit /b %ERRORLEVEL%

:help
echo Usage: dev.cmd [backend]
echo   dev.cmd          Start the backend and frontend
echo   dev.cmd backend  Start only the backend
exit /b 0
