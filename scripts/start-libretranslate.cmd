@echo off
rem Starts the self-hosted LibreTranslate instance from the .venv.
rem Usage:  start-libretranslate.cmd [load-only-langs]
rem Example: start-libretranslate.cmd en,es,fr,ja
setlocal
set ROOT=%~dp0..
set PYTHONUTF8=1
set LANG_LIST=%*
if "%LANG_LIST%"=="" set LANG_LIST=en,es,id
echo [libretranslate] starting on http://localhost:5000  (languages: %LANG_LIST%)
if not exist "%ROOT%\.venv\Scripts\libretranslate.exe" (
  echo [libretranslate] venv not found. Run scripts\setup_libretranslate.ps1 first.
  exit /b 1
)
"%ROOT%\.venv\Scripts\libretranslate.exe" --host 0.0.0.0 --port 5000 --load-only %LANG_LIST%
