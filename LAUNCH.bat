@echo off
title Q4NT PRO Launcher
cd /d "%~dp0"

echo [Q4NT] Starting backend server...
start "Q4NT Server" cmd /k "python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload"

echo [Q4NT] Waiting for server to initialize...
timeout /t 3 /nobreak >nul

echo [Q4NT] Opening workspace...
start "" "%~dp0index.html"

echo [Q4NT] Done. Server is running at http://localhost:8000
