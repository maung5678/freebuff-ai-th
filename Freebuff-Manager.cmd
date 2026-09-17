@echo off
setlocal
if exist "%~dp0manager-app\node_modules\.bin\electron.cmd" (
  call "%~dp0manager-app\node_modules\.bin\electron.cmd" "%~dp0manager-app"
) else (
  echo Freebuff Manager has not been built yet.
  echo Run: cd manager-app ^&^& npm install ^&^& npm start
  pause
)
endlocal
