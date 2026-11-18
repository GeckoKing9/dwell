<#
Puts Dwell back into Chrome when Chrome drops it, and does nothing otherwise.

Why: an unpacked extension lives only in the profile's protected settings
("Secure Preferences"). When Chrome resets those (it did on the first start of
Chrome 158, 2026-11-17), Web Store extensions come back from the Google account
and an unpacked one is simply gone. Its data stays on disk, keyed by its id, and
the id comes from the folder path, so loading the same folder again brings the
history back.

What it does, every run:
  1. Reads the profile's Secure Preferences. Dwell present with its path: exit.
  2. Chrome not running, or a failed attempt in the last 12 hours: exit.
  3. Opens a new Chrome window in that profile, goes to chrome://extensions,
     turns on Developer mode if it is off, presses Load unpacked, types the
     folder in the folder picker and selects it, then waits for Chrome to
     record the extension. Every step is logged to keep-loaded.log.

-CheckOnly reports the state and changes nothing. -ProfileDir defaults to the
Chrome profile that holds Dwell's data.
#>
param(
  [string]$ProfileDir,
  [string]$ExtensionDir = (Join-Path $env:LOCALAPPDATA 'Dwell\extension'),
  [switch]$CheckOnly,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Home_ = Join-Path $env:LOCALAPPDATA 'Dwell'
$Log = Join-Path $Home_ 'keep-loaded.log'
$FailMark = Join-Path $Home_ 'keep-loaded.failed'
$UserData = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'

function Write-Log([string]$Message) {
  $line = '{0} {1}' -f (Get-Date -Format 's'), $Message
  Add-Content -Path $Log -Value $line -Encoding UTF8
  Write-Output $line
}

# Chrome's id for an unpacked folder: SHA-256 of the UTF-16 path, first 16 bytes, hex digits mapped to a-p.
function Get-UnpackedId([string]$Path) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $hash = $sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($Path))
  $hex = -join ($hash[0..15] | ForEach-Object { $_.ToString('x2') })
  -join ($hex.ToCharArray() | ForEach-Object { [char](97 + [Convert]::ToInt32([string]$_, 16)) })
}

# Returns 'loaded', 'disabled', 'missing' or 'unknown' (file unreadable: never act on it).
function Get-DwellState([string]$Id) {
  Add-Type -AssemblyName System.Web.Extensions
  try {
    $text = [IO.File]::ReadAllText($SecurePrefs)
    $json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $json.MaxJsonLength = [int]::MaxValue
    $prefs = $json.DeserializeObject($text)
    $settings = $prefs['extensions']['settings']
  } catch {
    return 'unknown'
  }
  if ($null -eq $settings) { return 'unknown' }
  if (-not $settings.ContainsKey($Id)) { return 'missing' }
  $entry = $settings[$Id]
  if (-not $entry.ContainsKey('path') -or -not $entry['path']) { return 'missing' }
  if ($entry.ContainsKey('disable_reasons')) {
    $reasons = $entry['disable_reasons']
    # A list in current Chrome, a bitmask in older versions.
    if (($reasons -is [array] -and $reasons.Count -gt 0) -or ($reasons -isnot [array] -and [int]$reasons -ne 0)) { return 'disabled' }
  }
  return 'loaded'
}

function Show-Toast([string]$Text) {
  try {
    $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $nodes = $xml.GetElementsByTagName('text')
    $null = $nodes.Item(0).AppendChild($xml.CreateTextNode('Dwell'))
    $null = $nodes.Item(1).AppendChild($xml.CreateTextNode($Text))
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
  } catch {
    Write-Log "toast failed: $($_.Exception.Message)"
  }
}

$id = Get-UnpackedId $ExtensionDir
if (-not $ProfileDir) {
  $owner = Get-ChildItem -Path $UserData -Directory | Where-Object { Test-Path (Join-Path $_.FullName "Local Extension Settings\$id") } | Select-Object -First 1
  $ProfileDir = if ($owner) { $owner.Name } else { 'Default' }
}
$SecurePrefs = Join-Path $UserData (Join-Path $ProfileDir 'Secure Preferences')
$state = Get-DwellState $id
if ($CheckOnly) { Write-Output "$state $id $ExtensionDir"; exit 0 }
if ($state -ne 'missing') {
  $last = if (Test-Path $Log) { Get-Content $Log -Tail 1 } else { '' }
  if ($state -eq 'disabled' -and $last -notmatch 'disabled') { Write-Log "Dwell is in Chrome but disabled ($id); left alone" }
  exit 0
}
if (-not (Test-Path (Join-Path $ExtensionDir 'manifest.json'))) { Write-Log "no manifest in $ExtensionDir; nothing to load"; exit 1 }
if (-not (Get-Process chrome -ErrorAction SilentlyContinue)) { exit 0 }
if (-not $Force -and (Test-Path $FailMark) -and ((Get-Date) - (Get-Item $FailMark).LastWriteTime).TotalHours -lt 12) { exit 0 }

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace '' -Name DwellWin32 -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
'@
$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]

function New-Cond($Property, $Value) { New-Object System.Windows.Automation.PropertyCondition($Property, $Value) }

function Wait-For([scriptblock]$Probe, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $found = & $Probe
    if ($found) { return $found }
    Start-Sleep -Milliseconds 400
  } while ((Get-Date) -lt $deadline)
  return $null
}

# Electron apps (Discord, VS Code) use the same window class, so keep only chrome.exe windows.
function Find-ChromeWindow([string]$TitlePrefix, [switch]$All) {
  $chromeIds = @(Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object Id)
  foreach ($w in $AE::RootElement.FindAll($Scope::Children, (New-Cond $AE::ClassNameProperty 'Chrome_WidgetWin_1'))) {
    if ($chromeIds -notcontains $w.Current.ProcessId) { continue }
    if (([string]$w.Current.Name).StartsWith($TitlePrefix)) { if ($All) { $w } else { return $w } }
  }
}

function Find-Named($Root, $ControlType, [string[]]$Names) {
  foreach ($el in $Root.FindAll($Scope::Descendants, (New-Cond $AE::ControlTypeProperty $ControlType))) {
    if ($Names -contains $el.Current.Name) { return $el }
  }
}

$e = [char]0xE9
function Fail([string]$Why) {
  Write-Log "restore failed: $Why"
  Set-Content -Path $FailMark -Value $Why -Encoding UTF8
  Show-Toast "Chrome a retir$e Dwell et la remise automatique a $([char]0xE9)chou$e ($Why). Charge $ExtensionDir dans chrome://extensions."
  exit 1
}

# Any error from here on counts as a failed attempt, so the 12-hour pause applies to it too.
trap { Fail "unexpected error: $($_.Exception.Message)" }
Write-Log "Dwell missing from $ProfileDir ($id); restoring from $ExtensionDir"
$chrome = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe').'(default)'
# Chrome refuses chrome:// pages on its command line. A new window opens on the new tab page with the
# address bar focused, so the address is typed there and Enter is posted to that window alone: it can
# never reach another app, even when Windows keeps the new window in the background.
$before = @(Find-ChromeWindow '' -All | ForEach-Object { $_.Current.NativeWindowHandle })
Start-Process $chrome -ArgumentList "--profile-directory=`"$ProfileDir`"", '--new-window'
$win = Wait-For { Find-ChromeWindow '' -All | Where-Object { $before -notcontains $_.Current.NativeWindowHandle } | Select-Object -First 1 } 20
if (-not $win) { Fail 'the new Chrome window did not open' }
$hwnd = [IntPtr]$win.Current.NativeWindowHandle

$omnibox = Wait-For { $win.FindFirst($Scope::Descendants, (New-Cond $AE::ControlTypeProperty $CT::Edit)) } 10
if (-not $omnibox) { Fail 'address bar not found' }
try { $omnibox.SetFocus() } catch { Write-Log "address bar focus refused: $($_.Exception.Message)" }
$omnibox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('chrome://extensions/')
Start-Sleep -Milliseconds 300
[void][DwellWin32]::PostMessage($hwnd, 0x0100, [IntPtr]0x0D, [IntPtr]0x001C0001)   # WM_KEYDOWN Enter
[void][DwellWin32]::PostMessage($hwnd, 0x0101, [IntPtr]0x0D, [IntPtr]0xC01C0001)   # WM_KEYUP Enter
$opened = Wait-For { if ($AE::FromHandle($hwnd).Current.Name.StartsWith('Extensions')) { $true } } 15
if (-not $opened) { Fail 'chrome://extensions did not open' }

$loadNames = @("Charger l'extension non empaquet$([char]0xE9)e", 'Load unpacked')
$devNames = @("Mode d$([char]0xE9)veloppeur", 'Developer mode')
$load = Wait-For { Find-Named $win $CT::Button $loadNames } 10
if (-not $load) {
  $dev = Find-Named $win $CT::Button $devNames
  if (-not $dev) { $dev = Find-Named $win $CT::CheckBox $devNames }
  if (-not $dev) { Fail 'neither Load unpacked nor the Developer mode switch was found' }
  $dev.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle()
  Write-Log 'Developer mode was off; turned it on'
  $load = Wait-For { Find-Named $win $CT::Button $loadNames } 10
  if (-not $load) { Fail 'Load unpacked did not appear after turning on Developer mode' }
}
$load.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()

$dialog = Wait-For {
  # The picker is owned by the Extensions window, so UI Automation lists it under that window.
  $win.FindFirst($Scope::Children, (New-Cond $AE::ClassNameProperty '#32770'))
} 15
if (-not $dialog) { Fail 'the folder picker did not open' }

# The picker's folder box and button show up in UI Automation without patterns, so drive them as Win32 controls.
$nameBox = $dialog.FindFirst($Scope::Descendants, (New-Cond $AE::AutomationIdProperty '1152'))
$select = $dialog.FindFirst($Scope::Children, (New-Cond $AE::AutomationIdProperty '1'))
if (-not $nameBox -or -not $select) { Fail 'the folder picker has no folder box or select button' }
$dialogHwnd = [IntPtr]$dialog.Current.NativeWindowHandle
$boxHwnd = [IntPtr]$nameBox.Current.NativeWindowHandle
$selectHwnd = [IntPtr]$select.Current.NativeWindowHandle
function Submit-Folder([string]$Text) {
  [void][DwellWin32]::SendMessage($boxHwnd, 0x000C, [IntPtr]::Zero, $Text)                # WM_SETTEXT
  [void][DwellWin32]::PostMessage($dialogHwnd, 0x0111, [IntPtr]1, $selectHwnd)            # WM_COMMAND IDOK
}
Submit-Folder $ExtensionDir
Start-Sleep -Seconds 2
# A picker may open the typed folder instead of returning it; pressing again returns the folder it now shows.
if ([DwellWin32]::IsWindow($dialogHwnd)) { Submit-Folder '' }

# Chrome writes Secure Preferences a few seconds after a change.
$ok = Wait-For { if ((Get-DwellState $id) -eq 'loaded') { $true } } 40
if (-not $ok) { Fail 'Chrome did not record the extension (look for a load error on chrome://extensions)' }
if (Test-Path $FailMark) { Remove-Item $FailMark }
Write-Log "restored: Dwell is loaded again as $id"
Show-Toast "Chrome avait retir$e Dwell; il est remis, avec ton historique."
