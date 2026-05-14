@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PYTHON_CMD=py -3
) else (
    where python >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo Python was not found. Please install Python 3.9 or newer first.
        echo.
        pause
        exit /b 1
    )
    set PYTHON_CMD=python
)

if not exist ".venv-dataset\Scripts\python.exe" (
    echo Creating local Python environment...
    %PYTHON_CMD% -m venv .venv-dataset
    if %ERRORLEVEL% NEQ 0 (
        echo Failed to create Python environment.
        pause
        exit /b 1
    )
)

set VENV_PYTHON=%CD%\.venv-dataset\Scripts\python.exe

echo Installing required packages...
"%VENV_PYTHON%" -m pip install --upgrade pip
"%VENV_PYTHON%" -m pip install -r requirements-optional.txt
if %ERRORLEVEL% NEQ 0 (
    echo Failed to install packages.
    pause
    exit /b 1
)

echo Starting Thyroid Dataset Tool...
"%VENV_PYTHON%" thyroid_dataset_gui.py

pause
