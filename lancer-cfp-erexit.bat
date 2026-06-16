@echo off
setlocal

cd /d "%~dp0"

set "NODE_CMD=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\OpenAI\Codex\bin\node.exe" (
    set "NODE_CMD=%LOCALAPPDATA%\OpenAI\Codex\bin\node.exe"
  ) else (
    echo Node.js est introuvable.
    echo Installe Node.js, puis relance ce fichier.
    pause
    exit /b 1
  )
)

echo Lancement de CFP EREXIT Manager...
echo Adresse : http://localhost:3000
echo.
"%NODE_CMD%" server.js

pause
