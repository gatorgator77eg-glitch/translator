@echo off
cd /d "%~dp0"
echo Starting Voice Translator...
echo   Frontend: http://localhost:8080
echo   Backend:  http://localhost:3000
echo   (LibreTranslate :5000 auto-starts from .venv if present)
echo.
start "Voice Translator" cmd /k "npm run dev"
echo Opening browser in a few seconds...
timeout /t 8 /nobreak >nul
start "" http://localhost:8080
