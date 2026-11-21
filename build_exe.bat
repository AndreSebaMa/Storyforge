@echo off
cd /d "%~dp0"
python -m pip install --upgrade pyinstaller || exit /b 1
python -m PyInstaller --noconfirm --clean --onefile --name Storyforge --specpath build --add-data "%~dp0web;web" server.py || exit /b 1
echo.
echo Built dist\Storyforge.exe
echo Projects, backups, fonts and settings are stored next to the exe.
