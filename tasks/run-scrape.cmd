@echo off
rem PublicHealthAlert nightly scrape (01:00 ET) — invoked by Windows Task Scheduler.
rem Sets a known-good PATH so node, git, and netlify resolve under non-interactive sessions.
setlocal
set "PROJECT=H:\TCG-Fabric\external\PublicHealthAlert"
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Users\American Rental\AppData\Roaming\npm;%PATH%"
set "LOG=%PROJECT%\logs\scrape\schtasks.log"
if not exist "%PROJECT%\logs\scrape" mkdir "%PROJECT%\logs\scrape"
cd /d "%PROJECT%"
>>"%LOG%" echo.
>>"%LOG%" echo === [%DATE% %TIME%] scrape starting ===
node scripts\scrape.mjs >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo === [%DATE% %TIME%] scrape exit=%RC% ===
exit /b %RC%
