param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sourceAppRoot = Join-Path $projectRoot 'dist\windows\BeybladeTracker-1.0.0'
$sourceLauncherRoot = Join-Path $projectRoot 'release\windows'
$runId = [Guid]::NewGuid().ToString('N')
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$installRoot = Join-Path $tempRoot "BeybladeTracker-LCH-$runId-install"
$userRoot = Join-Path $tempRoot "BeybladeTracker-LCH-$runId-user"
$appRoot = Join-Path $installRoot 'versions\1.0.0'
$launcherPath = Join-Path $installRoot 'launcher.ps1'
$currentPath = Join-Path $installRoot 'current.json'
$nodePath = Join-Path $appRoot 'runtime\node.exe'
$controlScriptPath = Join-Path $appRoot 'scripts\service-control.js'
$currentBackupPath = "$currentPath.lch-backup"
$nodeBackupPath = "$nodePath.lch-backup"
$controlScriptBackupPath = "$controlScriptPath.lch-backup"
$results = @()
$primaryError = $null
$cleanupErrors = @()
$originalUserRoot = $env:BEYBLADE_USER_ROOT

function Assert-LchPath([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if ([System.IO.Path]::GetDirectoryName($resolved) -ne $tempRoot -or
      -not [System.IO.Path]::GetFileName($resolved).StartsWith("BeybladeTracker-LCH-$runId-")) {
    throw "拒絕修改或清理非本次驗收的暫存路徑：$resolved"
  }
}

function Assert-LchInstallItem([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  $prefix = $installRoot.TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒絕修改隔離安裝目錄以外的檔案：$resolved"
  }
}

function New-LchResult([string]$Id, [string]$Name, [string]$Expected, [string]$Status, [string]$Actual, [string]$Reason = '') {
  return [pscustomobject]@{
    Id = $Id
    Name = $Name
    Expected = $Expected
    Status = $Status
    Actual = $Actual
    Reason = $Reason
  }
}

function Write-LchResult($Result) {
  $actual = if ([string]::IsNullOrWhiteSpace($Result.Actual)) { '(空白)' } else { ($Result.Actual -replace "`r?`n", ' | ') }
  Write-Host "案例 $($Result.Id) $($Result.Name) : $($Result.Status)  (預期 $($Result.Expected), 實得 $actual)"
  if ($Result.Reason) { Write-Host "  $($Result.Reason)" }
}

function Restore-LchInjection {
  foreach ($item in @(
    @{ Target = $currentPath; Backup = $currentBackupPath },
    @{ Target = $nodePath; Backup = $nodeBackupPath },
    @{ Target = $controlScriptPath; Backup = $controlScriptBackupPath }
  )) {
    Assert-LchInstallItem $item.Target
    Assert-LchInstallItem $item.Backup
    if (Test-Path -LiteralPath $item.Backup) {
      if (Test-Path -LiteralPath $item.Target) { Remove-Item -LiteralPath $item.Target -Force -ErrorAction Stop }
      Move-Item -LiteralPath $item.Backup -Destination $item.Target -Force -ErrorAction Stop
    }
  }
}

function Set-LchMissingFile([string]$Target, [string]$Backup) {
  Assert-LchInstallItem $Target
  Assert-LchInstallItem $Backup
  if (-not (Test-Path -LiteralPath $Target)) { throw "隔離安裝內缺少預期檔案：$Target" }
  Copy-Item -LiteralPath $Target -Destination $Backup -Force -ErrorAction Stop
  Remove-Item -LiteralPath $Target -Force -ErrorAction Stop
}

function Set-LchControlStub([int]$ExitCode) {
  Assert-LchInstallItem $controlScriptPath
  Assert-LchInstallItem $controlScriptBackupPath
  if (-not (Test-Path -LiteralPath $controlScriptPath)) { throw '隔離安裝內缺少 service-control.js。' }
  Move-Item -LiteralPath $controlScriptPath -Destination $controlScriptBackupPath -Force -ErrorAction Stop
  Set-Content -LiteralPath $controlScriptPath -Value "process.exitCode = $ExitCode;" -Encoding utf8 -NoNewline -ErrorAction Stop
}

function Invoke-LchCase([string]$Id, [string]$Name, [string]$Action, [string]$Expected, [int]$TimeoutSeconds = 30) {
  $process = $null
  try {
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo.FileName = 'powershell.exe'
    $process.StartInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $launcherPath + '" -Action ' + $Action + ' -NonInteractive'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    [void]$process.Start()
    # Read both pipes asynchronously: a blocking ReadToEnd would only return once the
    # child exits, which makes the timeout below unreachable for exactly the hang this
    # harness exists to catch, and can deadlock when the child fills the other pipe.
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $process.Kill() } catch { }
      return New-LchResult $Id $Name $Expected 'FAIL' '' "執行超過 $TimeoutSeconds 秒，launcher 未結束。"
    }
    $stderr = $stderrTask.Result
    $stdout = $stdoutTask.Result

    $actual = $stderr.Trim()
    $failures = @()
    if ($process.ExitCode -ne 1) { $failures += "exit code 為 $($process.ExitCode)，不是 1" }
    if ($actual -cne $Expected) { $failures += 'stderr 並非預期的單一錯誤代碼' }
    foreach ($forbidden in @($installRoot, $userRoot, '.ps1', '.js', 'at line', 'CategoryInfo', 'Exception', 'StackTrace', 'http://', 'https://')) {
      if ($stderr.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $failures += "stderr 包含不安全字樣：$forbidden"
      }
    }
    if ($stdout) { $failures += 'launcher 對標準輸出寫入了非預期內容' }
    if ($failures.Count) { return New-LchResult $Id $Name $Expected 'FAIL' $actual ($failures -join '；') }
    return New-LchResult $Id $Name $Expected 'PASS' $actual
  } catch {
    return New-LchResult $Id $Name $Expected 'FAIL' '' "執行 launcher 時發生例外：$($_.Exception.Message)"
  } finally {
    if ($process) { $process.Dispose() }
  }
}

function Stop-LchProcesses {
  $candidates = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($runId) -and $_.CommandLine.Contains($installRoot)
  }
  foreach ($candidate in $candidates) {
    Stop-Process -Id $candidate.ProcessId -Force -ErrorAction Stop
  }
}

function Remove-LchPaths {
  foreach ($path in @($installRoot, $userRoot)) {
    Assert-LchPath $path
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop }
  }
  $remaining = @(Get-ChildItem -LiteralPath $tempRoot -Directory -Filter "BeybladeTracker-LCH-$runId-*" -ErrorAction Stop)
  if ($remaining.Count) { throw '暫存目錄清理後仍有本次驗收殘留。' }
  Write-Host '已確認本次驗收的暫存安裝與使用者目錄均已刪除。'
}

Assert-LchPath $installRoot
Assert-LchPath $userRoot

try {
  if (-not (Test-Path -LiteralPath $sourceAppRoot)) { throw "找不到發佈內容：$sourceAppRoot" }
  foreach ($launcherFile in @('launcher.ps1', 'launcher.vbs')) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceLauncherRoot $launcherFile))) { throw "找不到 launcher 檔案：$launcherFile" }
  }

  New-Item -ItemType Directory -Path (Join-Path $installRoot 'versions') -Force | Out-Null
  New-Item -ItemType Directory -Path $userRoot -Force | Out-Null
  Copy-Item -LiteralPath $sourceAppRoot -Destination $appRoot -Recurse -Force -ErrorAction Stop
  Copy-Item -LiteralPath (Join-Path $sourceLauncherRoot 'launcher.ps1') -Destination $launcherPath -Force -ErrorAction Stop
  Copy-Item -LiteralPath (Join-Path $sourceLauncherRoot 'launcher.vbs') -Destination (Join-Path $installRoot 'launcher.vbs') -Force -ErrorAction Stop
  Set-Content -LiteralPath $currentPath -Value '{"version":"1.0.0"}' -Encoding utf8 -NoNewline -ErrorAction Stop
  $env:BEYBLADE_USER_ROOT = $userRoot

  Restore-LchInjection
  Set-LchMissingFile $currentPath $currentBackupPath
  $results += Invoke-LchCase 'A' 'current.json 缺失' 'start' 'BT-LCH-001'
  Write-LchResult $results[-1]

  Restore-LchInjection
  Set-LchMissingFile $nodePath $nodeBackupPath
  $results += Invoke-LchCase 'B' 'runtime 缺失' 'start' 'BT-LCH-002'
  Write-LchResult $results[-1]

  Restore-LchInjection
  Set-LchControlStub 1
  $results += Invoke-LchCase 'C' 'service failure' 'start' 'BT-LCH-003'
  Write-LchResult $results[-1]

  Restore-LchInjection
  $listeners = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count) {
    $results += New-LchResult 'D' 'health timeout' 'BT-LCH-004' 'SKIPPED' 'SKIPPED' '案例 D 已跳過：port 8787 有其他服務在監聽，health timeout 無法驗證。請先停止該服務（開始功能表的「停止背景追蹤」）後重跑。'
  } else {
    Set-LchControlStub 0
    $results += Invoke-LchCase 'D' 'health timeout' 'start' 'BT-LCH-004' 60
  }
  Write-LchResult $results[-1]

  Restore-LchInjection
  $results += Invoke-LchCase 'E' '非互動模式不支援的動作' 'export' 'BT-LCH-006'
  Write-LchResult $results[-1]
} catch {
  $primaryError = $_
} finally {
  try { Restore-LchInjection } catch { $cleanupErrors += $_ }
  try { Stop-LchProcesses } catch { $cleanupErrors += $_ }
  try { Remove-LchPaths } catch { $cleanupErrors += $_ }
  if ($null -eq $originalUserRoot) { Remove-Item Env:BEYBLADE_USER_ROOT -ErrorAction SilentlyContinue } else { $env:BEYBLADE_USER_ROOT = $originalUserRoot }
}

Write-Host ''
Write-Host 'Launcher 錯誤代碼驗收彙總：'
foreach ($result in $results) {
  Write-Host "  案例 $($result.Id)：$($result.Status)"
}
$passCount = @($results | Where-Object Status -eq 'PASS').Count
$failCount = @($results | Where-Object Status -eq 'FAIL').Count
$skippedCount = @($results | Where-Object Status -eq 'SKIPPED').Count
Write-Host "統計：PASS=$passCount，FAIL=$failCount，SKIPPED=$skippedCount"

if ($primaryError) {
  Write-Error "Launcher 錯誤代碼驗收無法完成：$($primaryError.Exception.Message)"
  if ($cleanupErrors.Count) { Write-Error "清理時另有錯誤：$(($cleanupErrors | ForEach-Object { $_.Exception.Message }) -join '；')" }
  exit 1
}
if ($cleanupErrors.Count) {
  Write-Error "Launcher 錯誤代碼驗收清理失敗：$(($cleanupErrors | ForEach-Object { $_.Exception.Message }) -join '；')"
  exit 1
}
if ($failCount -gt 0) {
  Write-Error 'Launcher 錯誤代碼驗收失敗。'
  exit 1
}
if ($skippedCount -gt 0) {
  Write-Host 'Launcher 錯誤代碼驗收未完整驗證：有案例因環境條件跳過。'
}
exit 0
