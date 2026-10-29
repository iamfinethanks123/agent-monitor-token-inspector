@echo off
setlocal
cd /d "%~dp0"
echo Close the collector window first. Keep the tunnel connected for this one-time setup.
"%~dp0runtime\node.exe" "%~dp0collector.cjs" enable-offline
pause
