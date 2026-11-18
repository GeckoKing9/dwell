<#
Installs keep-loaded.ps1 next to the unpacked extension and runs it at logon and every
15 minutes, so a Chrome settings reset never leaves Dwell out for long. Run it again
after changing the script; -Uninstall removes the task and the copied script.
#>
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$TaskName = 'Dwell keep loaded'
$Target = Join-Path $env:LOCALAPPDATA 'Dwell\keep-loaded.ps1'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
if ($Uninstall) {
  Remove-Item $Target -ErrorAction SilentlyContinue
  Write-Output "removed task '$TaskName' and $Target"
  exit 0
}

Copy-Item (Join-Path $PSScriptRoot 'keep-loaded.ps1') $Target -Force
# conhost --headless runs PowerShell without flashing a console window.
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" `
  -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Target`""
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15))
)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal `
  -Description 'Reloads the unpacked Dwell extension if Chrome drops it (keep-loaded.ps1).' | Out-Null
Write-Output "installed task '$TaskName' -> $Target"
