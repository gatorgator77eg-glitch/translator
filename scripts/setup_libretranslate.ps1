# Sets up a self-hosted LibreTranslate instance inside a dedicated Python
# virtual environment (never installed globally). Run from the project root.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\setup_libretranslate.ps1
#
# After setup, point the backend at it:
#   $env:LIBRETRANSLATE_URL = "http://localhost:5000"
#   npm run start:backend

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $Root ".venv"
$Python = Join-Path $Venv "Scripts\python.exe"
$Pip = Join-Path $Venv "Scripts\pip.exe"

Write-Host "[setup] virtual environment -> $Venv"
if (-not (Test-Path $Python)) {
    Write-Host "[setup] creating venv..."
    python -m venv $Venv
}

Write-Host "[setup] installing libretranslate into venv (large download, may take a while)..."
& $Pip install --upgrade pip libretranslate

Write-Host "[setup] done. Start the local instance with:"
Write-Host "  & `"$Python`" -m libretranslate --host 0.0.0.0 --port 5000"
Write-Host "  Then set LIBRETRANSLATE_URL=http://localhost:5000 for the backend."
