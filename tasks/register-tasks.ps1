# Register PublicHealthAlert-Scrape (01:00 daily) and PublicHealthAlert-Verify
# (02:00 daily) Windows Scheduled Tasks. Run from any PowerShell prompt as the
# current user — no elevation required.
#
# Re-running this script is safe: it removes the existing tasks first.

$ErrorActionPreference = 'Stop'

$project   = 'C:\Tools\PublicHealthAlert'
$scrapeCmd = Join-Path $project 'tasks\run-scrape.cmd'
$verifyCmd = Join-Path $project 'tasks\run-verify.cmd'

if (-not (Test-Path $scrapeCmd)) { throw "Missing $scrapeCmd" }
if (-not (Test-Path $verifyCmd)) { throw "Missing $verifyCmd" }

function Register-PHATask {
    param(
        [string]$Name,
        [string]$Cmd,
        [string]$At,
        [string]$Description
    )
    $existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }
    $action = New-ScheduledTaskAction -Execute $Cmd -WorkingDirectory $project
    $trigger = New-ScheduledTaskTrigger -Daily -At $At
    $settings = New-ScheduledTaskSettingsSet `
        -WakeToRun `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
        -MultipleInstances IgnoreNew
    Register-ScheduledTask `
        -TaskName $Name `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description $Description `
        -RunLevel Limited | Out-Null
    Write-Host "Registered: $Name (daily at $At)"
}

Register-PHATask -Name 'PublicHealthAlert-Scrape' -Cmd $scrapeCmd -At '01:00' `
    -Description 'PublicHealthAlert nightly scrape — pulls outbreak feeds from CDC, PAHO, WHO DON, ECDC, Africa CDC into local data archive.'

Register-PHATask -Name 'PublicHealthAlert-Verify' -Cmd $verifyCmd -At '02:00' `
    -Description 'PublicHealthAlert nightly verifier — validates the 01:00 scrape and publishes (git push + netlify deploy --prod) or republishes last-known-good if validation fails.'

Write-Host ''
Write-Host 'Done. Verify with:'
Write-Host '  Get-ScheduledTask -TaskName PublicHealthAlert-* | Format-Table TaskName, State, NextRunTime'
