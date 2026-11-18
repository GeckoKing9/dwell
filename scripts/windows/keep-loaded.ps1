<#
Puts Dwell back into Chrome when Chrome drops it, and does nothing otherwise.

Why: an unpacked extension lives only in the profile's protected settings
("Secure Preferences"). When Chrome resets those (it did on the first start of
Chrome 158, 2026-11-17), Web Store extensions come back from the Google account
and an unpacked one is simply gone. Its data stays on disk, keyed by its id, and
the id comes from the folder path, so loading the same folder again brings the
history back. Removing Dwell from chrome://extensions deletes that data, so a
profile without it means Dwell was removed on purpose: the guard then does nothing.

What it does, every run:
  1. Finds the profile holding Dwell's data (or -ProfileDir) and reads its
     Secure Preferences. Dwell present, disabled, removed or unreadable: exit.
  2. Chrome not running, or a failed attempt in the last 12 hours: exit.
  3. Opens a new Chrome window in that profile and acts only on it: checks it is
     a fresh one-tab new tab page, goes to chrome://extensions, turns on Developer
     mode only if it reads off, presses Load unpacked, puts the folder in the
     picker and confirms only when the picker holds that folder, waits for Chrome
     to record the extension, then closes the window. Every step is logged.

-CheckOnly reports the state and changes nothing. -NoRun only defines the
functions (keep-loaded.tests.ps1 uses it).
#>
param(
  [string]$ProfileDir,
  [string]$ExtensionDir = (Join-Path $env:LOCALAPPDATA 'Dwell\extension'),
  [switch]$CheckOnly,
  [switch]$Force,
  [switch]$NoRun
)

$ErrorActionPreference = 'Stop'
$Log = Join-Path $env:LOCALAPPDATA 'Dwell\keep-loaded.log'
$FailMark = Join-Path $env:LOCALAPPDATA 'Dwell\keep-loaded.failed'
$UserData = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
$e = [char]0xE9
$script:OwnHwnd = [IntPtr]::Zero
$script:PickerHwnd = [IntPtr]::Zero

function Write-Log([string]$Message) {
  $line = '{0} {1}' -f (Get-Date -Format 's'), $Message
  Add-Content -Path $Log -Value $line -Encoding UTF8
  Write-Output $line
}

# A state that lasts is logged once, not every 15 minutes.
function Write-LogOnce([string]$Message) {
  $last = if (Test-Path $Log) { [string](Get-Content $Log -Tail 1) } else { '' }
  if ($last.EndsWith(" $Message")) { return $false }
  Write-Log $Message | Out-Null
  $true
}

# The path as Chrome's folder picker hands it over: absolute, no trailing separator, on-disk case, upper-case drive.
function Get-CanonicalPath([string]$Path) {
  # Relative paths resolve against PowerShell's location, not the process's working folder.
  $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path).TrimEnd('\')
  $root = [IO.Path]::GetPathRoot($full)
  $out = $root.ToUpperInvariant()
  foreach ($part in $full.Substring($root.Length).Split([char]'\', [StringSplitOptions]::RemoveEmptyEntries)) {
    # A folder that does not exist keeps the typed spelling; any other read error stops the run.
    $hit = if ([IO.Directory]::Exists($out)) { @([IO.Directory]::GetFileSystemEntries($out, $part)) | Select-Object -First 1 }
    $out = if ($hit) { $hit } else { Join-Path $out $part }
  }
  $out
}

# Chrome's id for an unpacked folder: SHA-256 of the UTF-16 path, first 16 bytes, hex digits mapped to a-p.
function Get-UnpackedId([string]$Path) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $hash = $sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($Path))
  $hex = -join ($hash[0..15] | ForEach-Object { $_.ToString('x2') })
  -join ($hex.ToCharArray() | ForEach-Object { [char](97 + [Convert]::ToInt32([string]$_, 16)) })
}

# 'loaded', 'disabled', 'missing', or 'unknown: <why>' (never act on unknown).
function Get-DwellState([string]$PrefsPath, [string]$Id, [string]$Dir) {
  Add-Type -AssemblyName System.Web.Extensions
  try {
    $json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $json.MaxJsonLength = [int]::MaxValue
    $prefs = $json.DeserializeObject([IO.File]::ReadAllText($PrefsPath))
  } catch {
    return "unknown: $PrefsPath unreadable ($($_.Exception.Message))"
  }
  $ext = if ($prefs -is [Collections.IDictionary] -and $prefs.ContainsKey('extensions')) { $prefs['extensions'] }
  $settings = if ($ext -is [Collections.IDictionary] -and $ext.ContainsKey('settings')) { $ext['settings'] }
  if ($settings -isnot [Collections.IDictionary]) { return "unknown: no extensions.settings in $PrefsPath" }
  $entry = $null
  foreach ($key in $settings.Keys) {
    $v = $settings[$key]
    if ($v -isnot [Collections.IDictionary] -or -not $v.ContainsKey('path') -or -not $v['path']) { continue }
    # The same folder under another spelling of its path still counts as present.
    if ($key -eq $Id -or ([string]$v['path']).TrimEnd('\') -eq $Dir) { $entry = $v; break }
  }
  if (-not $entry) { return 'missing' }
  if ($entry.ContainsKey('disable_reasons')) {
    $reasons = $entry['disable_reasons']
    # A list in current Chrome, a bitmask in older versions.
    if (($reasons -is [array] -and $reasons.Count -gt 0) -or ($reasons -isnot [array] -and [int]$reasons -ne 0)) { return 'disabled' }
  }
  'loaded'
}

function Test-Paused([string]$Mark, [datetime]$Now) {
  (Test-Path $Mark) -and (($Now - (Get-Item $Mark).LastWriteTime).TotalHours -lt 12)
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

# Cancels the picker and closes the window this run opened, and nothing else.
function Close-OwnWindows {
  if ($script:PickerHwnd -ne [IntPtr]::Zero -and [DwellWin32]::IsWindow($script:PickerHwnd)) {
    [void][DwellWin32]::PostMessage($script:PickerHwnd, 0x0111, [IntPtr]2, [IntPtr]::Zero)   # WM_COMMAND IDCANCEL
    Start-Sleep -Milliseconds 500
  }
  if ($script:OwnHwnd -ne [IntPtr]::Zero -and [DwellWin32]::IsWindow($script:OwnHwnd)) {
    # A tab the owner opened or dragged in meanwhile keeps the window open.
    $tabs = -1
    try {
      $w = [System.Windows.Automation.AutomationElement]::FromHandle($script:OwnHwnd)
      $tabs = @($w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)))).Count
    } catch { }
    if ($tabs -eq 1) { [void][DwellWin32]::PostMessage($script:OwnHwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) } # WM_CLOSE
    else { try { Write-Log "left the guard's window open: it holds $tabs tabs now" } catch { } }
  }
}

function Fail([string]$Why, [string]$Dir) {
  Set-Content -Path $FailMark -Value $Why -Encoding UTF8
  try { Write-Log "restore failed: $Why" } catch { }
  Close-OwnWindows
  Show-Toast "Chrome a retir$e Dwell et la remise automatique a $($e)chou$e ($Why). Charge $Dir dans chrome://extensions."
  exit 1
}

function Restore-Dwell([string]$ProfileName, [string]$Dir, [string]$Id, [string]$Prefs) {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  Add-Type -Namespace '' -Name DwellWin32 -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, System.Text.StringBuilder lParam);
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
    $null
  }
  # Electron apps (Discord, VS Code) use the same window class, so keep only chrome.exe windows.
  function Get-ChromeWindows {
    $ids = @(Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object Id)
    foreach ($w in $AE::RootElement.FindAll($Scope::Children, (New-Cond $AE::ClassNameProperty 'Chrome_WidgetWin_1'))) {
      if ($ids -contains $w.Current.ProcessId) { $w }
    }
  }
  function Find-Named($Root, $ControlType, [string[]]$Names) {
    foreach ($el in $Root.FindAll($Scope::Descendants, (New-Cond $AE::ControlTypeProperty $ControlType))) {
      if ($Names -contains $el.Current.Name) { return $el }
    }
  }
  function Get-Text([IntPtr]$Hwnd) {
    $sb = New-Object System.Text.StringBuilder 1024
    [void][DwellWin32]::SendMessage($Hwnd, 0x000D, [IntPtr]1024, $sb)   # WM_GETTEXT
    $sb.ToString()
  }

  trap { Fail "unexpected error: $($_.Exception.Message)" $Dir }
  Write-Log "Dwell missing from $ProfileName ($Id); restoring from $Dir"
  $chrome = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe').'(default)'
  # Chrome refuses chrome:// pages on its command line. The window this run opens is a new HWND holding one
  # new tab page with an empty address bar: a window the owner already had, a restored one, or a popup or
  # hover card never matches. Enter is posted to that window alone, so it can never reach another app.
  $before = @(Get-ChromeWindows | ForEach-Object { $_.Current.NativeWindowHandle })
  Start-Process $chrome -ArgumentList "--profile-directory=`"$ProfileName`"", '--new-window'
  $found = Wait-For {
    foreach ($w in Get-ChromeWindows) {
      # Hover cards and menus come and go during the wait: one that vanishes mid-check is skipped.
      try {
        if ($before -contains $w.Current.NativeWindowHandle) { continue }
        $tabs = @($w.FindAll($Scope::Descendants, (New-Cond $AE::ControlTypeProperty $CT::TabItem)))
        $edit = $w.FindFirst($Scope::Descendants, (New-Cond $AE::ControlTypeProperty $CT::Edit))
        if ($tabs.Count -eq 1 -and $edit -and $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -eq '') {
          return , @($w, $edit)
        }
      } catch { continue }
    }
  } 20
  if (-not $found) { Fail 'the new Chrome window did not open' $Dir }
  $win, $omnibox = $found
  $script:OwnHwnd = [IntPtr]$win.Current.NativeWindowHandle

  # A new window opens with its address bar focused; focus is moved only if it is not, so typing elsewhere is not pulled in.
  if (-not $omnibox.Current.HasKeyboardFocus) {
    try { $omnibox.SetFocus() } catch { Write-Log "address bar focus refused: $($_.Exception.Message)" }
  }
  $omnibox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('chrome://extensions/')
  Start-Sleep -Milliseconds 300
  [void][DwellWin32]::PostMessage($script:OwnHwnd, 0x0100, [IntPtr]0x0D, [IntPtr]0x001C0001)   # WM_KEYDOWN Enter
  [void][DwellWin32]::PostMessage($script:OwnHwnd, 0x0101, [IntPtr]0x0D, [IntPtr]0xC01C0001)   # WM_KEYUP Enter
  # A page can set its title; only Chrome's address bar proves the tab shows chrome://extensions.
  $opened = Wait-For {
    if ($AE::FromHandle($script:OwnHwnd).Current.Name.StartsWith('Extensions') -and
        $omnibox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -like 'chrome://extensions*') { $true }
  } 15
  if (-not $opened) { Fail 'chrome://extensions did not open' $Dir }
  # Another extension can open or switch tabs in this window at any time, so the page is proven again before each action.
  function Assert-OwnPage([string]$Step) {
    $ok = $false
    try {
      $tabs = @($win.FindAll($Scope::Descendants, (New-Cond $AE::ControlTypeProperty $CT::TabItem))).Count
      $url = $omnibox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
      $ok = $tabs -eq 1 -and $url -like 'chrome://extensions*'
    } catch { }
    if (-not $ok) { Fail "the guard's window no longer shows only chrome://extensions ($Step)" $Dir }
  }

  $loadNames = @("Charger l'extension non empaquet$($e)e", 'Load unpacked')
  $devNames = @("Mode d$($e)veloppeur", 'Developer mode')
  $load = Wait-For { Find-Named $win $CT::Button $loadNames } 10
  if (-not $load) {
    $dev = Find-Named $win $CT::Button $devNames
    if (-not $dev) { $dev = Find-Named $win $CT::CheckBox $devNames }
    if (-not $dev) { Fail 'neither Load unpacked nor the Developer mode switch was found' $Dir }
    $toggle = $dev.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $was = $toggle.Current.ToggleState
    # Only an Off switch is turned on: a renamed button must never turn Developer mode off.
    if ($was -ne [System.Windows.Automation.ToggleState]::Off) { Fail "Load unpacked not found while Developer mode reads $was" $Dir }
    Assert-OwnPage 'before Developer mode'
    $toggle.Toggle()
    Write-Log 'Developer mode was off; turned it on'
    $load = Wait-For { Find-Named $win $CT::Button $loadNames } 10
    if (-not $load) { Fail 'Load unpacked did not appear after turning on Developer mode' $Dir }
  }
  Assert-OwnPage 'before Load unpacked'
  $load.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()

  # The picker is owned by the Extensions window, so UI Automation lists it under that window.
  $dialog = Wait-For { $win.FindFirst($Scope::Children, (New-Cond $AE::ClassNameProperty '#32770')) } 15
  if (-not $dialog) { Fail 'the folder picker did not open' $Dir }
  $script:PickerHwnd = [IntPtr]$dialog.Current.NativeWindowHandle
  # The folder box and button have no UI Automation patterns, so they are driven as Win32 controls.
  $nameBox = $dialog.FindFirst($Scope::Descendants, (New-Cond $AE::AutomationIdProperty '1152'))
  $select = $dialog.FindFirst($Scope::Children, (New-Cond $AE::AutomationIdProperty '1'))
  if (-not $nameBox -or -not $select) { Fail 'the folder picker has no folder box or select button' $Dir }
  $boxHwnd = [IntPtr]$nameBox.Current.NativeWindowHandle
  $selectHwnd = [IntPtr]$select.Current.NativeWindowHandle
  Assert-OwnPage 'before the folder picker'
  [void][DwellWin32]::SendMessage($boxHwnd, 0x000C, [IntPtr]::Zero, $Dir)   # WM_SETTEXT
  if ((Get-Text $boxHwnd) -ne $Dir) { Fail 'the folder box did not take the path' $Dir }
  [void][DwellWin32]::PostMessage($script:PickerHwnd, 0x0111, [IntPtr]1, $selectHwnd)   # WM_COMMAND IDOK
  Start-Sleep -Seconds 2
  if ([DwellWin32]::IsWindow($script:PickerHwnd)) {
    # The picker opened the typed folder instead of returning it. Confirm again only if it now shows that folder.
    $address = $dialog.FindFirst($Scope::Descendants, (New-Cond $AE::AutomationIdProperty '1001'))
    # Its address reads 'Address: <path>' in the picker's language; only the full path proves the folder.
    $shown = if ($address) { ([string]$address.Current.Name -split ':\s', 2)[-1] } else { '' }
    if ($shown -ne $Dir) { Fail "the picker shows '$shown', not $Dir" $Dir }
    Assert-OwnPage 'before confirming the picker again'
    [void][DwellWin32]::SendMessage($boxHwnd, 0x000C, [IntPtr]::Zero, '')
    [void][DwellWin32]::PostMessage($script:PickerHwnd, 0x0111, [IntPtr]1, $selectHwnd)
  }

  # Chrome writes Secure Preferences a few seconds after a change.
  $ok = Wait-For { if ((Get-DwellState $Prefs $Id $Dir) -eq 'loaded') { $true } } 40
  if (-not $ok) { Fail 'Chrome did not record the extension (look for a load error on chrome://extensions)' $Dir }
  if (Test-Path $FailMark) { Remove-Item $FailMark }
  Write-Log "restored: Dwell is loaded again as $Id"
  Close-OwnWindows
  Show-Toast "Chrome avait retir$e Dwell; il est remis, avec ton historique."
}

function Invoke-Guard {
  $dir = Get-CanonicalPath $ExtensionDir
  $id = Get-UnpackedId $dir
  # Every profile still holding Dwell's data is checked, so one profile keeping Dwell cannot hide another that lost it.
  $profiles = if ($ProfileDir) { @($ProfileDir) } else {
    @(Get-ChildItem -Path $UserData -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName "Local Extension Settings\$id") } | ForEach-Object Name)
  }
  $results = foreach ($p in $profiles) {
    $state = if (Test-Path (Join-Path $UserData "$p\Local Extension Settings\$id")) { Get-DwellState (Join-Path $UserData "$p\Secure Preferences") $id $dir } else { 'removed' }
    [pscustomobject]@{ Profile = $p; State = $state }
  }
  if ($CheckOnly) {
    if (-not $results) { Write-Output "removed $id (no profile holds its data) $dir" }
    foreach ($r in $results) { Write-Output "$($r.State) $id $($r.Profile) $dir" }
    return
  }
  if (-not $results) { [void](Write-LogOnce "no Dwell data ($id) in any Chrome profile: removed on purpose or never loaded; nothing to do"); return }
  foreach ($r in $results) {
    switch -Wildcard ($r.State) {
      'removed' { [void](Write-LogOnce "no Dwell data ($id) in $($r.Profile): removed on purpose or never loaded; nothing to do") }
      'unknown*' { [void](Write-LogOnce "$($r.Profile): state $($r.State); nothing done") }
      'disabled' { [void](Write-LogOnce "Dwell is in Chrome profile $($r.Profile) but disabled ($id); left alone") }
    }
  }
  $target = $results | Where-Object State -eq 'missing' | Select-Object -First 1
  if (-not $target) { return }
  if (-not (Get-Process chrome -ErrorAction SilentlyContinue)) { return }
  if (-not $Force -and (Test-Paused $FailMark (Get-Date))) { return }
  if (-not (Test-Path (Join-Path $dir 'manifest.json'))) {
    # A build being rebuilt or cleaned: say so once and try again next run, with no 12-hour pause.
    if (Write-LogOnce "Dwell is missing from $($target.Profile) but $dir has no manifest.json (no build there); retrying next run") {
      Show-Toast "Chrome a retir$e Dwell, mais $dir n'a pas de build (manifest.json). Lance npm run build ou recopie le dossier."
    }
    return
  }
  # Marked before acting, so a run killed half-way (time limit, logoff) still pauses the next ones.
  Set-Content -Path $FailMark -Value 'attempt started' -Encoding UTF8
  Restore-Dwell $target.Profile $dir $id (Join-Path $UserData "$($target.Profile)\Secure Preferences")
}

if (-not $NoRun) {
  try { Invoke-Guard } catch { [void](Write-LogOnce "guard error: $($_.Exception.Message)"); exit 1 }
}
