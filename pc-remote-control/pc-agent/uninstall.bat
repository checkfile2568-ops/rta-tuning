@echo off
schtasks /Delete /TN "PC Remote Control Agent" /F
if errorlevel 1 echo Task was not found or could not be removed.
pause
