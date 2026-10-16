@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Creating virtual environment...
  python -m venv .venv || py -3 -m venv .venv
  if errorlevel 1 ( echo Python 3.10+ is required: https://www.python.org/downloads/ & pause & exit /b 1 )
)
.venv\Scripts\python -m pip install -q -r requirements.txt
if not exist .env copy .env.example .env >nul
.venv\Scripts\python run.py
pause
