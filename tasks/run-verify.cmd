@echo off
rem PublicHealthAlert nightly verify + publish (02:00 ET) — invoked by Windows Task Scheduler.
rem Validates the 01:00 scrape, then commits/pushes and deploys to Netlify.
setlocal
set "PROJECT=H:\TCG-Fabric\external\PublicHealthAlert"
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Users\American Rental\AppData\Roaming\npm;%PATH%"
set "LOG=%PROJECT%\logs\verify\schtasks.log"
if not exist "%PROJECT%\logs\verify" mkdir "%PROJECT%\logs\verify"
cd /d "%PROJECT%"
>>"%LOG%" echo.
>>"%LOG%" echo === [%DATE% %TIME%] verify starting ===
node scripts\verify-publish.mjs >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo === [%DATE% %TIME%] verify exit=%RC% ===
exit /b %RC%
