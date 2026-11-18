<#
Installs keep-loaded.ps1 in %LOCALAPPDATA%\Dwell and runs it at logon and every
15 minutes, so a Chrome settings reset never leaves Dwell out for long. Run it again
after changing the script. -ExtensionDir names the folder Dwell is loaded from
(default %LOCALAPPDATA%\Dwell\extension), -ProfileDir pins a Chrome profile folder
(default: the one holding Dwell's data). -Uninstall removes the task and the copy.
#>
param([string]$ExtensionDir, [string]$ProfileDir, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$TaskName = 'Dwell keep loaded'
$Target = Join-Path $env:LOCALAPPDATA 'Dwell\keep-loaded.ps1'

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Remove-Item $Target -ErrorAction SilentlyContinue
  Write-Output "removed task '$TaskName' and $Target"
  exit 0
}

# Running it again keeps the folder and profile the task already had, unless new ones are given.
$old = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$oldArgs = if ($old) { [string]$old.Actions[0].Arguments } else { '' }
if (-not $ExtensionDir -and $oldArgs -match '-ExtensionDir "([^"]+)"') { $ExtensionDir = $Matches[1] }
if (-not $ProfileDir -and $oldArgs -match '-ProfileDir "([^"]+)"') { $ProfileDir = $Matches[1] }
if ($ExtensionDir) {
  # Relative paths resolve against PowerShell's location, not the process's working folder.
  $ExtensionDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ExtensionDir).TrimEnd('\')
}
$watched = if ($ExtensionDir) { $ExtensionDir } else { Join-Path $env:LOCALAPPDATA 'Dwell\extension' }
if (-not (Test-Path (Join-Path $watched 'manifest.json'))) { throw "no manifest.json in $watched: pass -ExtensionDir with the folder Chrome loads Dwell from" }

New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'keep-loaded.ps1') $Target -Force
$arguments = "--headless $env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Target`""
if ($ExtensionDir) { $arguments += " -ExtensionDir `"$ExtensionDir`"" }
if ($ProfileDir) { $arguments += " -ProfileDir `"$ProfileDir`"" }
# conhost --headless runs PowerShell without flashing a console window.
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" -Argument $arguments
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15))
)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
# -Force replaces an existing task in one step, so a failed copy above never leaves the owner without one.
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force `
  -Description 'Reloads the unpacked Dwell extension if Chrome drops it (keep-loaded.ps1).' | Out-Null
Write-Output "installed task '$TaskName' -> $Target $arguments"
