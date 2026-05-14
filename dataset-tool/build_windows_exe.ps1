$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "Building ThyroidDatasetTool.exe ..." -ForegroundColor Cyan

if (Get-Command py -ErrorAction SilentlyContinue) {
    $Python = "py"
    $PythonArgs = @("-3")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $Python = "python"
    $PythonArgs = @()
} else {
    throw "Python was not found. Please install Python 3.9 or newer first."
}

Write-Host "Using Python:" -ForegroundColor Cyan
& $Python @PythonArgs --version

& $Python @PythonArgs -m venv .venv-package-windows
$VenvPython = Join-Path $ScriptDir ".venv-package-windows\Scripts\python.exe"

& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -r requirements-optional.txt pyinstaller

& $VenvPython -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --windowed `
    --name ThyroidDatasetTool `
    thyroid_dataset_gui.py

$ExePath = Join-Path $ScriptDir "dist\ThyroidDatasetTool.exe"
if (-not (Test-Path $ExePath)) {
    throw "Build finished but executable was not found: $ExePath"
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning "ffmpeg was not found. The EXE can still run, but video de-identification needs ffmpeg installed on the Windows computer."
}

Write-Host ""
Write-Host "Done:" -ForegroundColor Green
Write-Host $ExePath
Write-Host ""
Write-Host "You can copy dist\ThyroidDatasetTool.exe to the hospital computer and double-click it."
