<#
The guard's decisions, checked with no Chrome and no UI:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\keep-loaded.tests.ps1
Exits with the number of failed checks.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'keep-loaded.ps1') -NoRun
$script:failed = 0
function Check([string]$Name, $Actual, $Expected) {
  if ([string]$Actual -ceq [string]$Expected) { Write-Output "ok   $Name" }
  else { Write-Output "FAIL $Name`n     got:      $Actual`n     expected: $Expected"; $script:failed++ }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('dwell-guard-tests-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path (Join-Path $tmp 'Ext') | Out-Null
try {
  # The algorithm matched Chrome's own id for the owner's folder on 2026-11-18; this vector comes from an independent implementation.
  Check 'id of C:\Dwell\extension' (Get-UnpackedId 'C:\Dwell\extension') 'loooglpcakkjfihnceagkkpanmjhocdc'

  $real = Get-CanonicalPath (Join-Path $tmp 'Ext')
  Check 'canonical path drops a trailing backslash' (Get-CanonicalPath ((Join-Path $tmp 'Ext') + '\')) $real
  Check 'canonical path restores on-disk case and an upper-case drive' (Get-CanonicalPath $real.ToLowerInvariant()) $real
  Check 'canonical path keeps a folder that does not exist yet' (Get-CanonicalPath 'c:\no-such-dwell-dir\x\') 'C:\no-such-dwell-dir\x'
  Push-Location $tmp
  try { Check 'canonical path resolves a relative path against the current location' (Get-CanonicalPath 'ext') $real } finally { Pop-Location }

  $dir = 'C:\Dwell\extension'; $id = 'loooglpcakkjfihnceagkkpanmjhocdc'
  $prefs = Join-Path $tmp 'Secure Preferences'
  function State([string]$Json) { [IO.File]::WriteAllText($prefs, $Json); Get-DwellState $prefs $id $dir }
  $p = ConvertTo-Json -Compress $dir
  Check 'no entry: missing' (State '{"extensions":{"settings":{}}}') 'missing'
  Check 'the stub Chrome left after its reset: missing' (State "{`"extensions`":{`"settings`":{`"$id`":{`"dnr_static_ruleset`":{},`"has_started_service_worker`":true}}}}") 'missing'
  Check 'empty path: missing' (State "{`"extensions`":{`"settings`":{`"$id`":{`"path`":`"`"}}}}") 'missing'
  Check 'entry with path, no reasons: loaded' (State "{`"extensions`":{`"settings`":{`"$id`":{`"path`":$p,`"disable_reasons`":[]}}}}") 'loaded'
  Check 'reason list [1]: disabled' (State "{`"extensions`":{`"settings`":{`"$id`":{`"path`":$p,`"disable_reasons`":[1]}}}}") 'disabled'
  Check 'old bitmask 0: loaded' (State "{`"extensions`":{`"settings`":{`"$id`":{`"path`":$p,`"disable_reasons`":0}}}}") 'loaded'
  Check 'old bitmask 8: disabled' (State "{`"extensions`":{`"settings`":{`"$id`":{`"path`":$p,`"disable_reasons`":8}}}}") 'disabled'
  $other = ConvertTo-Json -Compress 'c:\dwell\EXTENSION\'
  Check 'same folder under another id and spelling: loaded' (State "{`"extensions`":{`"settings`":{`"abc`":{`"path`":$other}}}}") 'loaded'
  Check 'another extension only: missing' (State "{`"extensions`":{`"settings`":{`"abc`":{`"path`":`"C:\\\\other`"}}}}") 'missing'
  Check 'empty object: no extensions.settings' ((State '{}') -like 'unknown: no extensions.settings*') $true
  Check 'extensions without settings: no extensions.settings' ((State '{"extensions":{}}') -like 'unknown: no extensions.settings*') $true
  Check 'broken JSON: unreadable' ((State '{"extensions":') -like 'unknown:*unreadable*') $true
  Remove-Item $prefs
  Check 'no file: unknown' ((Get-DwellState $prefs $id $dir) -like 'unknown*') $true

  $mark = Join-Path $tmp 'failed'
  Check 'no mark: not paused' (Test-Paused $mark (Get-Date)) $false
  Set-Content $mark 'x'
  Check 'fresh mark: paused' (Test-Paused $mark (Get-Date)) $true
  (Get-Item $mark).LastWriteTime = (Get-Date).AddHours(-13)
  Check 'mark 13 hours old: not paused' (Test-Paused $mark (Get-Date)) $false
} finally {
  Remove-Item -Recurse -Force $tmp
}
Write-Output "$script:failed failed"
exit $script:failed
