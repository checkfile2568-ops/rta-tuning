@echo off
cd /d "%~dp0"
if not exist config.json (
  echo [ERROR] config.json not found. Copy config.example.json to config.json first.
  pause
  exit /b 1
)
python agent.py
