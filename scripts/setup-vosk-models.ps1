# Downloads the Vosk-compatible Indonesian speech model (bookbot-kids,
# Apache-2.0) and repackages it as a .tar.gz that vosk-browser can load into
# frontend/models/vosk-model-small-id.tar.gz. Run once from the project root.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\setup-vosk-models.ps1
#
# Source model: https://github.com/bookbot-kids/speech-recognizer-bahasa-indonesian
# (trained on children's speech — accuracy on adult meeting audio is limited).
# Requires Windows 10 1803+ (bundled bsdtar) and internet access.

$ErrorActionPreference = "Stop"

$Repo = "bookbot-kids/speech-recognizer-bahasa-indonesian"
$Branch = "main"
$ModelRel = "speech_recognizer/android/app/src/main/assets/model-id-id"
$Root = Split-Path -Parent $PSScriptRoot
$ModelsDir = Join-Path $Root "frontend\models"
$OutFile = Join-Path $ModelsDir "vosk-model-small-id.tar.gz"
$Temp = Join-Path $env:TEMP "vosk-model-id"

Write-Host "[setup] Indonesian speech model (Vosk-compatible, Apache-2.0)"
Write-Host "[setup] source: github.com/$Repo (children's speech recognizer, see README)"
Write-Host "[setup] target: $OutFile"

$tar = Get-Command tar -ErrorAction SilentlyContinue
if (-not $tar) { throw "The 'tar' command is required (bundled with Windows 10 1803+)." }

if (-not (Test-Path $ModelsDir)) { New-Item -ItemType Directory -Path $ModelsDir | Out-Null }
if (Test-Path $Temp) { Remove-Item -Recurse -Force $Temp }
New-Item -ItemType Directory -Path $Temp | Out-Null

Write-Host "[setup] fetching model file list..."
$TreeUrl = "https://api.github.com/repos/$Repo/git/trees/$Branch`?recursive=1"
$Tree = Invoke-RestMethod -Uri $TreeUrl -Headers @{ "User-Agent" = "voice-translator-setup" }
$Files = $Tree.tree | Where-Object { $_.type -eq "blob" -and $_.path.StartsWith("$ModelRel/") }
if (-not $Files) { throw "Could not find model files in the repository tree." }

Write-Host "[setup] downloading $($Files.Count) files to $Temp ..."
$Base = "https://raw.githubusercontent.com/$Repo/$Branch"
foreach ($f in $Files) {
    $rel = $f.path.Substring($ModelRel.Length + 1)
    $dest = Join-Path $Temp ($rel -replace "/", "\")
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Invoke-WebRequest -Uri "$Base/$($f.path)" -OutFile $dest -UseBasicParsing
}

Write-Host "[setup] packing $OutFile ..."
Push-Location $Temp
try {
    & $tar.Source --format ustar -czf $OutFile .
    if (-not $?) { throw "tar failed to create the model archive." }
}
finally {
    Pop-Location
}
Remove-Item -Recurse -Force $Temp

$SizeMb = [math]::Round((Get-Item $OutFile).Length / 1MB, 1)
Write-Host "[setup] done ($SizeMb MB). Reload the app, choose Screen audio mode,"
Write-Host "[setup] and set the source language to Indonesian."
