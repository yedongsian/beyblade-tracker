param([string]$InstallerPath = "")
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $InstallerPath) { $InstallerPath = Join-Path $projectRoot 'dist\windows\installer\BeybladeTracker-1.0.0-Setup.exe' }
$runId = [Guid]::NewGuid().ToString('N')
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$installRoot = Join-Path $tempRoot "BeybladeTracker-E2E-$runId-install"
$userRoot = Join-Path $tempRoot "BeybladeTracker-E2E-$runId-user"
function Assert-E2ePath([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if ([System.IO.Path]::GetDirectoryName($resolved) -ne $tempRoot -or
      -not [System.IO.Path]::GetFileName($resolved).StartsWith("BeybladeTracker-E2E-$runId-")) {
    throw "Refusing to clean unexpected E2E path: $resolved"
  }
}
Assert-E2ePath $installRoot
Assert-E2ePath $userRoot
function Wait-E2eProcess([System.Diagnostics.Process]$Process, [string]$Label, [int]$TimeoutSeconds = 90) {
  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch { }
    throw "$Label timed out after $TimeoutSeconds seconds"
  }
  if ($Process.ExitCode -ne 0) { throw "$Label exit code $($Process.ExitCode)" }
}
function Wait-E2ePathAbsent([string]$Path, [string]$Label, [int]$TimeoutSeconds = 60) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while (Test-Path -LiteralPath $Path) {
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label did not remove its program files after $TimeoutSeconds seconds" }
    Start-Sleep -Milliseconds 250
  }
}
try {
  Write-Host "E2E install: $installRoot"
  $env:BEYBLADE_INSTALL_ROOT = $installRoot
  $env:BEYBLADE_USER_ROOT = $userRoot
  $process = Start-Process -FilePath $InstallerPath -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=',"/DIR=$installRoot") -PassThru
  Wait-E2eProcess $process 'Installer'
  $current = Get-Content -LiteralPath (Join-Path $installRoot 'current.json') -Raw | ConvertFrom-Json
  $appRoot = Join-Path $installRoot "versions\$($current.version)"
  $node = Join-Path $appRoot 'runtime\node.exe'
  if (-not (Test-Path -LiteralPath $node)) { throw 'Packaged Node runtime missing.' }
  $env:BEYBLADE_APP_ROOT = $appRoot
  Write-Host 'E2E packaged health check'
  & $node '--no-warnings' (Join-Path $appRoot 'bin\health-check.js')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged health check failed.' }
  if (-not (Test-Path -LiteralPath (Join-Path $userRoot 'data\tracker.db'))) { throw 'User database was not created.' }
  $uninstaller = Join-Path $installRoot 'unins000.exe'
  Write-Host 'E2E uninstall and data-preservation check'
  $process = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru
  Wait-E2eProcess $process 'Uninstaller'
  Wait-E2ePathAbsent $installRoot 'Uninstaller'
  if (-not (Test-Path -LiteralPath (Join-Path $userRoot 'data\tracker.db'))) { throw 'User data was not preserved.' }
  Write-Host 'PHASE 7 E2E OK: install, packaged runtime, health, uninstall, data preservation'
} finally {
  foreach ($path in @($installRoot, $userRoot)) {
    try {
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop }
    } catch {
      Write-Warning 'E2E cleanup deferred because a temporary test file is still in use.'
    }
  }
}
