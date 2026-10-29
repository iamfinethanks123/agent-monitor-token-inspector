@echo off
setlocal
cd /d "%~dp0"
echo Close the collector window first. No tunnel is needed after signing was enabled.
set "COLLECTOR_EXPORT_PATH=%~1"
if not defined COLLECTOR_EXPORT_PATH set "COLLECTOR_EXPORT_PATH=%~dp0offline-exports"
"%~dp0runtime\node.exe" "%~dp0collector.cjs" export-offline "%COLLECTOR_EXPORT_PATH%"
echo Export folder: %COLLECTOR_EXPORT_PATH%
pause
