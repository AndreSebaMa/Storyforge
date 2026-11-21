@echo off
cd /d "%~dp0"
set PY=
where python >nul 2>nul && set PY=python
if not defined PY where py >nul 2>nul && set PY=py -3
if not defined PY (
  echo Python 3.9 or newer is required: https://www.python.org/downloads/
  pause
  exit /b 1
)
%PY% server.py %*
pause
