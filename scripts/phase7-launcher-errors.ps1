param(
  # Case F opens a real dialog on the desktop, so it needs an interactive window station.
  [switch]$SkipDialogCase
)

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

# D-4 regression harness. launcher.vbs starts PowerShell with shell.Run(cmd, 0, False), so the
# process carries SW_HIDE and the first WinForms top-level window inherited it: the error dialog
# existed but was invisible and ShowDialog blocked on it forever. Process.MainWindowHandle only
# reports visible windows, which is why that failure looked like "no dialog at all". These
# enumerate every top-level window of the process, visible or not, so the invisible case is
# distinguishable from the missing case.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class BeybladeLchWindows {
  private delegate bool EnumProc(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr state);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern bool PostMessageW(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);

  public static string Text(IntPtr window) {
    StringBuilder text = new StringBuilder(1024);
    GetWindowTextW(window, text, text.Capacity);
    return text.ToString();
  }

  public static IntPtr[] TopLevel(uint processId) {
    List<IntPtr> found = new List<IntPtr>();
    EnumWindows(delegate(IntPtr window, IntPtr state) {
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      if (owner == processId) { found.Add(window); }
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  public static string[] ChildText(IntPtr parent) {
    List<string> found = new List<string>();
    EnumChildWindows(parent, delegate(IntPtr window, IntPtr state) {
      found.Add(Text(window));
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  public static bool Visible(IntPtr window) { return IsWindowVisible(window); }

  public static void Close(IntPtr window) { PostMessageW(window, 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
'@ -ErrorAction Stop

function Find-LchLauncherProcessId([int[]]$Exclude, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $candidates = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($launcherPath) -and $Exclude -notcontains $_.ProcessId })
    if ($candidates.Count) { return [int]$candidates[0].ProcessId }
    Start-Sleep -Milliseconds 250
  }
  return 0
}

# The form carries its title from the moment it is created, well before Shown fires and its controls
# are realized, so matching on the title alone races the dialog and reports a hidden, empty window.
# Wait for the state the user would actually see, and on timeout hand back whatever was found so the
# caller can tell "never appeared" apart from D-4's "appeared but stayed invisible".
function Wait-LchDialogWindow([int]$ProcessId, [string]$Title, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastMatch = [IntPtr]::Zero
  while ([DateTime]::UtcNow -lt $deadline) {
    foreach ($window in [BeybladeLchWindows]::TopLevel([uint32]$ProcessId)) {
      if ([BeybladeLchWindows]::Text($window) -ne $Title) { continue }
      $lastMatch = $window
      if ([BeybladeLchWindows]::Visible($window) -and @([BeybladeLchWindows]::ChildText($window)).Count -gt 0) {
        return $window
      }
    }
    Start-Sleep -Milliseconds 250
  }
  return $lastMatch
}

# The real Start-menu path: wscript hides the console host, and the launcher runs in interactive
# mode so a failure must raise a visible, operable dialog rather than only writing to stderr.
function Invoke-LchDialogCase([string]$Id, [string]$Name, [string]$Action, [string]$Expected, [int]$TimeoutSeconds = 45) {
  $vbsPath = Join-Path $installRoot 'launcher.vbs'
  $launcherPid = 0
  try {
    $existing = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($launcherPath) } | ForEach-Object { [int]$_.ProcessId })
    Start-Process -FilePath 'wscript.exe' -ArgumentList @("`"$vbsPath`"", $Action) -WindowStyle Hidden | Out-Null

    $launcherPid = Find-LchLauncherProcessId $existing 20
    if ($launcherPid -eq 0) { return New-LchResult $Id $Name $Expected 'FAIL' '' 'wscript 未啟動任何 launcher PowerShell 程序。' }

    $window = Wait-LchDialogWindow $launcherPid 'Beyblade Tracker' $TimeoutSeconds
    if ($window -eq [IntPtr]::Zero) {
      return New-LchResult $Id $Name $Expected 'FAIL' '(無視窗)' "$TimeoutSeconds 秒內未建立任何標題為 Beyblade Tracker 的頂層視窗。"
    }

    $failures = @()
    # The D-4 assertion: the window existed before the fix too, hidden and blocking forever.
    if (-not [BeybladeLchWindows]::Visible($window)) { $failures += '對話框視窗存在但不可見（D-4 回歸）' }
    $texts = @([BeybladeLchWindows]::ChildText($window))
    $body = ($texts -join "`n")
    if ($body.IndexOf($Expected, [StringComparison]::OrdinalIgnoreCase) -lt 0) { $failures += "對話框未顯示錯誤代碼 $Expected" }
    foreach ($button in @('複製錯誤資訊', '問題回報', '關閉')) {
      if ($texts -notcontains $button) { $failures += "對話框缺少「$button」按鈕" }
    }
    foreach ($forbidden in @($installRoot, $userRoot, '.ps1', '.js', 'http://', 'https://', 'StackTrace')) {
      if ($body.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $failures += "對話框顯示了不安全字樣：$forbidden"
      }
    }

    [BeybladeLchWindows]::Close($window)
    $closed = $false
    $closeDeadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $closeDeadline) {
      if (-not (Get-Process -Id $launcherPid -ErrorAction SilentlyContinue)) { $closed = $true; break }
      Start-Sleep -Milliseconds 250
    }
    # Before the fix the hidden ShowDialog could never be dismissed, so the process leaked forever.
    if (-not $closed) { $failures += '關閉對話框後 launcher 程序未結束（永久阻塞回歸）' }

    $actual = "visible=$([BeybladeLchWindows]::Visible($window)) buttons=$($texts.Count)"
    if ($failures.Count) { return New-LchResult $Id $Name $Expected 'FAIL' $actual ($failures -join '；') }
    return New-LchResult $Id $Name $Expected 'PASS' "visible=True closed=True code=$Expected"
  } catch {
    return New-LchResult $Id $Name $Expected 'FAIL' '' "執行互動 launcher 時發生例外：$($_.Exception.Message)"
  } finally {
    if ($launcherPid -gt 0) { Stop-Process -Id $launcherPid -Force -ErrorAction SilentlyContinue }
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

  Restore-LchInjection
  if ($SkipDialogCase) {
    $results += New-LchResult 'F' '互動對話框可見性' 'BT-LCH-001' 'SKIPPED' 'SKIPPED' '案例 F 已依 -SkipDialogCase 跳過。'
  } elseif (-not [Environment]::UserInteractive) {
    $results += New-LchResult 'F' '互動對話框可見性' 'BT-LCH-001' 'SKIPPED' 'SKIPPED' '案例 F 已跳過：目前工作階段沒有互動桌面，無法驗證視窗可見性。'
  } else {
    Set-LchMissingFile $currentPath $currentBackupPath
    $results += Invoke-LchDialogCase 'F' '互動對話框可見性' 'start' 'BT-LCH-001'
  }
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
