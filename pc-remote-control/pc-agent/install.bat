@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul || (echo [ERROR] Python not found in PATH & pause & exit /b 1)
python -m pip install -r requirements.txt || (echo [ERROR] pip install failed & pause & exit /b 1)
if not exist config.json copy config.example.json config.json >nul
for /f "delims=" %%P in ('where pythonw') do set PYTHONW=%%P
if "%PYTHONW%"=="" set PYTHONW=pythonw.exe
set TASK=PC Remote Control Agent
schtasks /Create /TN "%TASK%" /TR "\"%PYTHONW%\" \"%~dp0agent.py\"" /SC ONLOGON /RL HIGHEST /F
if errorlevel 1 (echo [WARN] Could not create scheduled task. Run this file as Administrator.) else (echo [OK] Scheduled task installed.)
echo IMPORTANT: Set PC_REMOTE_DEVICE_TOKEN as a Windows environment variable before starting the Agent.
echo Example: setx PC_REMOTE_DEVICE_TOKEN "YOUR_LONG_RANDOM_DEVICE_TOKEN"
pause
