@echo off
setlocal
cd /d "%~dp0"
echo Local-only mode does not connect to the dashboard or read enrollment credentials.
"%~dp0runtime\node.exe" "%~dp0collector.cjs" local
pause
