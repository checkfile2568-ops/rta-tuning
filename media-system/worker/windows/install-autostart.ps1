[CmdletBinding()]
param(
  [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
$taskName = 'MMs Media Worker'
$startScript = Join-Path $PSScriptRoot 'start-worker.ps1'

if (-not (Test-Path -LiteralPath $startScript)) { throw "Cannot find $startScript" }

$argument = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $startScript
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts the private MMs Media Worker after this user signs in.' -Force | Out-Null
Write-Host "Installed '$taskName'. It starts automatically after this user signs in."

if ($StartNow) { & $startScript }
