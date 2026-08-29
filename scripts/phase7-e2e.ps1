param([string]$InstallerPath = "", [switch]$StopFailureMode, [switch]$MissingLauncherMode)
$ErrorActionPreference = 'Stop'
# One injected condition per run: two at once would make a failure impossible to attribute.
if ($StopFailureMode -and $MissingLauncherMode) { throw 'Choose either -StopFailureMode or -MissingLauncherMode, not both.' }
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$appVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $InstallerPath) { $InstallerPath = Join-Path $projectRoot ('dist\windows\installer\BeybladeTracker-' + $appVersion + '-Setup.exe') }
$runId = [Guid]::NewGuid().ToString('N')
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$installRoot = Join-Path $tempRoot "BeybladeTracker-E2E-$runId-install"
$userRoot = Join-Path $tempRoot "BeybladeTracker-E2E-$runId-user"
$appRoot = $null
$node = $null
$servicePid = $null
$controlScriptPath = $null
$controlScriptBackup = $null
$launcherPath = $null
$launcherBackup = $null
function Assert-E2ePath([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if ([System.IO.Path]::GetDirectoryName($resolved) -ne $tempRoot -or
      -not [System.IO.Path]::GetFileName($resolved).StartsWith("BeybladeTracker-E2E-$runId-")) {
    throw "Refusing to clean unexpected E2E path: $resolved"
  }
}
Assert-E2ePath $installRoot
Assert-E2ePath $userRoot
# Caching the handle keeps ExitCode readable; an unreadable exit code must never be mistaken for a result.
function Start-E2eProcess([string]$FilePath, [string[]]$ArgumentList) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru
  try { $null = $process.Handle } catch { }
  return $process
}
function Wait-E2eProcess([System.Diagnostics.Process]$Process, [string]$Label, [int]$TimeoutSeconds = 90) {
  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    throw "$Label timed out after $TimeoutSeconds seconds"
  }
  if ($null -eq $Process.ExitCode) { throw "$Label exit code could not be read" }
  if ($Process.ExitCode -ne 0) { throw "$Label exit code $($Process.ExitCode)" }
}
function Wait-E2eProcessFailure([System.Diagnostics.Process]$Process, [string]$Label, [int]$TimeoutSeconds = 60) {
  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $Process.Kill() } catch { }
    throw "$Label did not fail within $TimeoutSeconds seconds; a non-interactive stop failure must be bounded"
  }
  if ($null -eq $Process.ExitCode) { throw "$Label exit code could not be read" }
  if ($Process.ExitCode -eq 0) { throw "$Label reported success even though the service stop failed" }
}
# Scoped to this run's own processes so an unrelated Tracker window cannot pass or fail the assertion.
function Assert-E2eNoLauncherDialog([string]$Label) {
  $ours = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($runId) -and $_.CommandLine.Contains($installRoot)
  }
  foreach ($candidate in $ours) {
    $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
    if ($process -and $process.MainWindowHandle -ne 0) {
      throw "$Label left an interactive window open during a silent operation"
    }
  }
}
function Wait-E2ePathAbsent([string]$Path, [string]$Label, [int]$TimeoutSeconds = 60) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while (Test-Path -LiteralPath $Path) {
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label did not remove its program files after $TimeoutSeconds seconds" }
    Start-Sleep -Milliseconds 250
  }
}
function Wait-E2eServiceHealthy([string]$ExpectedVersion, [int]$TimeoutSeconds = 45) {
  $pidFile = Join-Path $userRoot 'runtime\tracker.pid'
  $statusFile = Join-Path $userRoot 'runtime\tracker-status.json'
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastReason = 'service did not publish PID/status files'
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      if (-not (Test-Path -LiteralPath $pidFile) -or -not (Test-Path -LiteralPath $statusFile)) { throw 'service PID or status file is not ready' }
      $serviceProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
      $status = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
      Get-Process -Id $serviceProcessId -ErrorAction Stop | Out-Null
      if ($status.status -ne 'running' -or [int]$status.pid -ne $serviceProcessId -or $status.webUrl -ne 'http://127.0.0.1:8787') { throw 'service status does not match the running PID' }
      $health = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 3
      if ($health.status -notin @('ok', 'degraded') -or $health.release.version -ne $ExpectedVersion) { throw 'health response is not the installed service' }
      return $serviceProcessId
    } catch { $lastReason = $_.Exception.Message; Start-Sleep -Milliseconds 500 }
  }
  throw "Packaged service did not become healthy within $TimeoutSeconds seconds: $lastReason"
}
function Wait-E2eServiceStopped([int]$ServiceProcessId, [int]$TimeoutSeconds = 30) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not (Get-Process -Id $ServiceProcessId -ErrorAction SilentlyContinue)) {
      $listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $ServiceProcessId }
      if (-not $listener) { return }
    }
    Start-Sleep -Milliseconds 500
  }
  $status = if (Test-Path -LiteralPath (Join-Path $userRoot 'runtime\tracker-status.json')) { Get-Content -LiteralPath (Join-Path $userRoot 'runtime\tracker-status.json') -Raw } else { 'missing' }
  $logTail = if ($uninstallLog -and (Test-Path -LiteralPath $uninstallLog)) { (Get-Content -LiteralPath $uninstallLog -Tail 12) -join ' | ' } else { 'missing' }
  throw "Packaged service PID $ServiceProcessId did not stop cleanly; status=$status; uninstaller-log=$logTail"
}
# Injects a deterministic stop failure into this run's isolated install copy only; never the workspace source.
function Set-E2eStopFailure {
  $controlScriptPath = Join-Path $appRoot 'scripts\service-control.js'
  Assert-E2ePath $installRoot
  if (-not $controlScriptPath.StartsWith($installRoot)) { throw "Refusing to modify a control script outside this run: $controlScriptPath" }
  if (-not (Test-Path -LiteralPath $controlScriptPath)) { throw 'Installed service-control.js is missing.' }
  $controlScriptBackup = "$controlScriptPath.e2e-backup"
  Copy-Item -LiteralPath $controlScriptPath -Destination $controlScriptBackup -Force
  $stub = @'
#!/usr/bin/env node
console.error('E2E injected service-control failure');
process.exitCode = 1;
'@
  Set-Content -LiteralPath $controlScriptPath -Value $stub -Encoding utf8
  return @($controlScriptPath, $controlScriptBackup)
}
function Restore-E2eStopFailure {
  if (-not $controlScriptBackup -or -not (Test-Path -LiteralPath $controlScriptBackup)) { return }
  if (-not $controlScriptPath.StartsWith($installRoot)) { throw "Refusing to restore a control script outside this run: $controlScriptPath" }
  Move-Item -LiteralPath $controlScriptBackup -Destination $controlScriptPath -Force
}
# Moves this run's launcher aside so it can be restored; never touches the workspace or a real install.
function Set-E2eMissingLauncher {
  Assert-E2ePath $installRoot
  $launcherPath = Join-Path $installRoot 'launcher.ps1'
  if (-not $launcherPath.StartsWith($installRoot)) { throw "Refusing to move a launcher outside this run: $launcherPath" }
  if (-not (Test-Path -LiteralPath $launcherPath)) { throw 'Installed launcher.ps1 is missing before the negative test.' }
  $launcherBackup = "$launcherPath.e2e-backup"
  Move-Item -LiteralPath $launcherPath -Destination $launcherBackup -Force
  return @($launcherPath, $launcherBackup)
}
function Restore-E2eMissingLauncher {
  if (-not $launcherBackup -or -not (Test-Path -LiteralPath $launcherBackup)) { return }
  if (-not $launcherPath.StartsWith($installRoot)) { throw "Refusing to restore a launcher outside this run: $launcherPath" }
  Move-Item -LiteralPath $launcherBackup -Destination $launcherPath -Force
}
function Stop-E2eProcesses {
  $stopErrors = @()
  $serviceStillRunning = $servicePid -and (Get-Process -Id $servicePid -ErrorAction SilentlyContinue)
  $controlScript = if ($appRoot) { Join-Path $appRoot 'scripts\service-control.js' } else { $null }
  $canGracefullyStop = $false
  try {
    $canGracefullyStop = $serviceStillRunning -and $node -and $controlScript -and
      (Test-Path -LiteralPath $node -ErrorAction Stop) -and (Test-Path -LiteralPath $controlScript -ErrorAction Stop)
  } catch { $canGracefullyStop = $false }
  if ($canGracefullyStop) {
    try {
      & $node '--no-warnings' $controlScript stop
      $stopExitCode = $LASTEXITCODE
      if ($stopExitCode -ne 0) { throw "Packaged service-control stop failed with exit code $stopExitCode." }
    } catch { $stopErrors += $_ }
  } elseif ($serviceStillRunning) {
    $stopErrors += 'Packaged service-control is unavailable for a running E2E service.'
  }
  for ($attempt = 0; $attempt -lt 3; $attempt += 1) {
    $candidates = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
      $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($runId) -and $_.CommandLine.Contains($installRoot)
    }
    if (-not $candidates) { break }
    foreach ($candidate in $candidates) {
      try { Stop-Process -Id $candidate.ProcessId -Force -ErrorAction Stop }
      catch {
        if (Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue) { $stopErrors += $_ }
      }
    }
    Start-Sleep -Milliseconds 250
  }
  if ($stopErrors.Count) {
    $details = ($stopErrors | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ } }) -join '; '
    throw "E2E process cleanup failed: $details"
  }
}
function Remove-E2ePaths {
  foreach ($path in @($installRoot, $userRoot)) {
    Assert-E2ePath $path
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop }
  }
}
$primaryError = $null
$cleanupErrors = @()
try {
  Write-Host "E2E install: $installRoot"
  $env:BEYBLADE_INSTALL_ROOT = $installRoot
  $env:BEYBLADE_USER_ROOT = $userRoot
  New-Item -ItemType Directory -Path $userRoot -Force | Out-Null
  $installLog = Join-Path $userRoot 'installer.log'
  $process = Start-E2eProcess $InstallerPath @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=',"/DIR=$installRoot",("/LOG=`"$installLog`""))
  Wait-E2eProcess $process 'Installer'
  $current = Get-Content -LiteralPath (Join-Path $installRoot 'current.json') -Raw | ConvertFrom-Json
  $appRoot = Join-Path $installRoot "versions\$($current.version)"
  $node = Join-Path $appRoot 'runtime\node.exe'
  if (-not (Test-Path -LiteralPath $node)) { throw 'Packaged Node runtime missing.' }
  $servicePid = Wait-E2eServiceHealthy $current.version
  if (-not (Test-Path -LiteralPath (Join-Path $userRoot 'data\tracker.db'))) { throw 'User database was not created.' }
  Write-Host "E2E service healthy: PID=$servicePid, port=8787"
  $uninstaller = Join-Path $installRoot 'unins000.exe'
  $uninstallLog = Join-Path $userRoot 'uninstaller.log'
  if ($StopFailureMode) {
    Write-Host 'E2E negative path: injecting a service-control stop failure'
    $paths = Set-E2eStopFailure
    $controlScriptPath = $paths[0]
    $controlScriptBackup = $paths[1]
    $failLog = Join-Path $userRoot 'uninstaller-stop-failure.log'
    $started = [DateTime]::UtcNow
    $process = Start-E2eProcess $uninstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',("/LOG=`"$failLog`""))
    Wait-E2eProcessFailure $process 'Uninstaller with a failing service stop'
    $elapsed = [int]([DateTime]::UtcNow - $started).TotalSeconds
    Assert-E2eNoLauncherDialog 'Uninstaller with a failing service stop'
    if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'current.json'))) { throw 'Failed uninstall removed program files while the service was still running.' }
    if (-not (Get-Process -Id $servicePid -ErrorAction SilentlyContinue)) { throw 'Failed uninstall left no running service to protect; the stop failure was not simulated.' }
    Write-Host "E2E negative path OK: uninstaller failed in ${elapsed}s without UI and kept the running install"
    Restore-E2eStopFailure
    $controlScriptBackup = $null
  }
  if ($MissingLauncherMode) {
    Write-Host 'E2E negative path: moving the installed launcher.ps1 aside'
    $paths = Set-E2eMissingLauncher
    $launcherPath = $paths[0]
    $launcherBackup = $paths[1]
    $failLog = Join-Path $userRoot 'uninstaller-missing-launcher.log'
    $started = [DateTime]::UtcNow
    $process = Start-E2eProcess $uninstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',("/LOG=`"$failLog`""))
    # A missing launcher is detected before any stop attempt, so this must not approach the 35s stop timeout.
    Wait-E2eProcessFailure $process 'Uninstaller without a launcher' 15
    $elapsed = [int]([DateTime]::UtcNow - $started).TotalSeconds
    Assert-E2eNoLauncherDialog 'Uninstaller without a launcher'
    if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'current.json'))) { throw 'Uninstall without a launcher removed program files it could not prove were idle.' }
    if (-not (Test-Path -LiteralPath $appRoot)) { throw 'Uninstall without a launcher removed the installed version directory.' }
    if (-not (Get-Process -Id $servicePid -ErrorAction SilentlyContinue)) { throw 'Uninstall without a launcher stopped or killed the running service.' }
    $stillHealthyPid = Wait-E2eServiceHealthy $current.version 15
    if ($stillHealthyPid -ne $servicePid) { throw "Port 8787 is served by PID $stillHealthyPid instead of the protected service PID $servicePid." }
    if (-not (Test-Path -LiteralPath (Join-Path $userRoot 'data\tracker.db'))) { throw 'Uninstall without a launcher removed user data.' }
    Write-Host "E2E negative path OK: uninstaller failed in ${elapsed}s without UI and kept PID=$servicePid serving 8787"
    Restore-E2eMissingLauncher
    $launcherBackup = $null
  }
  Write-Host 'E2E uninstall and data-preservation check'
  $process = Start-E2eProcess $uninstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',("/LOG=`"$uninstallLog`""))
  Wait-E2eProcess $process 'Uninstaller'
  Assert-E2eNoLauncherDialog 'Uninstaller'
  Wait-E2eServiceStopped $servicePid
  Wait-E2ePathAbsent $installRoot 'Uninstaller'
  if (-not (Test-Path -LiteralPath (Join-Path $userRoot 'data\tracker.db'))) { throw 'User data was not preserved.' }
  if ($StopFailureMode) {
    Write-Host 'PHASE 7 NEGATIVE E2E OK: bounded silent stop failure, no UI, protected install, then clean uninstall'
  } elseif ($MissingLauncherMode) {
    Write-Host 'PHASE 7 NEGATIVE E2E OK: missing launcher fails closed, no UI, protected install and service, then clean uninstall'
  } else {
    Write-Host 'PHASE 7 E2E OK: install, packaged service health, uninstall, service stop, data preservation'
  }
} catch {
  $primaryError = $_
} finally {
  # Restore the injected conditions first so graceful cleanup has a complete install to work with.
  try { Restore-E2eMissingLauncher } catch { $cleanupErrors += $_ }
  try { Restore-E2eStopFailure } catch { $cleanupErrors += $_ }
  try { Stop-E2eProcesses } catch { $cleanupErrors += $_ }
  try { Remove-E2ePaths } catch { $cleanupErrors += $_ }
}
if ($cleanupErrors.Count) {
  $details = ($cleanupErrors | ForEach-Object { $_.Exception.Message }) -join '; '
  if ($primaryError) { throw "E2E failed: $($primaryError.Exception.Message); cleanup failed: $details" }
  throw "E2E cleanup failed: $details"
}
if ($primaryError) { throw $primaryError }
