@echo off
setlocal
set "MANAGER=%~dp0Freebuff Manager 0.2.3\Freebuff Manager 0.2.3.exe"
if exist "%MANAGER%" (
  start "" "%MANAGER%"
) else (
  echo Freebuff Manager 0.2.3 was not found:
  echo "%MANAGER%"
  pause
)
endlocal
