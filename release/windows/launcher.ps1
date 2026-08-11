param(
  [ValidateSet('open','start','restart','stop','status','export','import','update','rollback')][string]$Action='open',
  [switch]$NonInteractive
)
$ErrorActionPreference = 'Stop'
# Actions callable by the installer, uninstaller, startup automation and tests: never GUI, always bounded.
$nonInteractiveActions = @('start','restart','stop','status')
# Each bounded wait stays above the service-control timeout it drives (stop 35s, start 60s) plus the
# health probe service-control makes before it decides whether a slow start actually failed.
$controlTimeoutSeconds = @{ 'start' = 90; 'restart' = 130; 'stop' = 45; 'status' = 20 }

function Throw-LauncherError([string]$Code) {
  $launcherError = New-Object System.Exception($Code)
  $launcherError.Data['BeybladeCode'] = $Code
  throw $launcherError
}

function Show-LauncherError([string]$Code) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  # launcher.vbs starts this process with shell.Run(cmd, 0, False), so STARTUPINFO
  # carries SW_HIDE and the first top-level window inherits it. ShowDialog would then
  # block forever on a dialog nobody can see, which is how every launcher error became
  # silent. Force the window visible once it exists.
  if (-not ('BeybladeWin32' -as [type])) {
    Add-Type -Namespace BeybladeWin32 -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
'@ -PassThru | Out-Null
  }
  $details = @{
    'BT-LCH-001' = @('找不到目前版本', 'Beyblade Tracker 找不到目前安裝版本。', '重新安裝相同或更新版本。')
    'BT-LCH-002' = @('找不到執行環境', 'Beyblade Tracker 找不到內建執行環境。', '重新安裝，並檢查防毒軟體是否隔離檔案。')
    'BT-LCH-003' = @('背景服務啟動失敗', 'Beyblade Tracker 無法完成背景服務啟動。', '查看服務狀態後，稍後再試一次。')
    'BT-LCH-004' = @('等待服務逾時', 'Beyblade Tracker 等待服務回應逾時。', '等候一分鐘後再試，並確認 8787 port 未被其他程式占用。')
    'BT-LCH-005' = @('無法開啟管理頁', '背景服務已啟動，但無法開啟本機管理頁。', '稍後再試，或查看服務狀態。')
    'BT-LCH-006' = @('此操作需要互動模式', '這個操作需要視窗介面，無法在自動化模式執行。', '請從開始選單手動執行該功能。')
    'BT-LCH-999' = @('發生未預期的錯誤', 'Beyblade Tracker 發生未預期的內部錯誤。', '稍後再試；若持續發生，複製錯誤資訊後回報。')
  }
  if (-not $details.ContainsKey($Code)) { $Code = 'BT-LCH-999' }
  $item = $details[$Code]
  $appVersion = if ($version) { [string]$version } else { 'unknown' }
  $supportRef = [guid]::NewGuid().ToString('N').Substring(0, 12)
  $copyText = "錯誤代碼：$Code`r`nApp version：$appVersion`r`nUTC：$([DateTime]::UtcNow.ToString('o'))`r`nSupport reference：$supportRef"
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Beyblade Tracker'; $form.StartPosition = 'CenterScreen'; $form.Size = New-Object System.Drawing.Size(520, 320)
  $form.MinimizeBox = $false; $form.MaximizeBox = $false; $form.KeyPreview = $true
  $form.Add_KeyDown({ if ($_.KeyCode -eq 'Escape') { $form.Close() } })
  $label = New-Object System.Windows.Forms.Label
  $label.Location = New-Object System.Drawing.Point(24, 24); $label.Size = New-Object System.Drawing.Size(450, 155)
  $label.Font = New-Object System.Drawing.Font('Microsoft JhengHei UI', 10)
  $label.Text = "$Code`r`n$($item[0])`r`n`r`n$($item[1])`r`n$($item[2])`r`n`r`nApp version：$appVersion`r`nSupport reference：$supportRef"
  $copy = New-Object System.Windows.Forms.Button
  $copy.Text = '複製錯誤資訊'; $copy.Location = New-Object System.Drawing.Point(24, 220); $copy.Size = New-Object System.Drawing.Size(125, 32)
  $copy.Add_Click({ [System.Windows.Forms.Clipboard]::SetText($copyText) })
  $report = New-Object System.Windows.Forms.Button
  $report.Text = '問題回報'; $report.Location = New-Object System.Drawing.Point(160, 220); $report.Size = New-Object System.Drawing.Size(100, 32)
  # The template is a GitHub Issue Form, which has no free-form body: every field is addressed by its
  # own id, so a body= parameter binds to nothing. The old link filled only the title and left 錯誤代碼
  # and App 版本 empty — the two fields this is supposed to prefill. Field ids come from
  # .github/ISSUE_TEMPLATE/bug_report.yml; only the two the user cannot retype accurately are sent.
  $report.Add_Click({
    $query = 'template=bug_report.yml' +
      '&title=' + [uri]::EscapeDataString("[問題回報] $Code") +
      '&error_code=' + [uri]::EscapeDataString($Code) +
      '&app_version=' + [uri]::EscapeDataString($appVersion)
    Start-Process "https://github.com/yedongsian/beyblade-tracker/issues/new?$query"
  })
  $status = New-Object System.Windows.Forms.Button
  $status.Text = '服務狀態'; $status.Location = New-Object System.Drawing.Point(271, 220); $status.Size = New-Object System.Drawing.Size(100, 32)
  $status.Add_Click({ Start-Process 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Action status" })
  $close = New-Object System.Windows.Forms.Button
  $close.Text = '關閉'; $close.Location = New-Object System.Drawing.Point(382, 220); $close.Size = New-Object System.Drawing.Size(90, 32); $close.Add_Click({ $form.Close() })
  $form.Controls.AddRange(@($label, $copy, $report, $status, $close))
  $form.TopMost = $true
  # SW_SHOWNORMAL = 1. Handle is only valid once the form is created, so do it on Shown.
  $form.Add_Shown({
    [void][BeybladeWin32.Native]::ShowWindow($form.Handle, 1)
    [void][BeybladeWin32.Native]::SetForegroundWindow($form.Handle)
    $form.Activate()
  })
  $form.ShowDialog() | Out-Null
}

try {
if ($NonInteractive -and ($nonInteractiveActions -notcontains $Action)) { Throw-LauncherError 'BT-LCH-006' }
$installRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$currentPath = Join-Path $installRoot 'current.json'
if (-not (Test-Path -LiteralPath $currentPath)) { Throw-LauncherError 'BT-LCH-001' }
try { $version = (Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json).version } catch { Throw-LauncherError 'BT-LCH-001' }
if ([string]::IsNullOrWhiteSpace($version)) { Throw-LauncherError 'BT-LCH-001' }
$appRoot = Join-Path (Join-Path $installRoot 'versions') $version
$node = Join-Path $appRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $node)) { Throw-LauncherError 'BT-LCH-002' }
$userRoot = if ([string]::IsNullOrWhiteSpace($env:BEYBLADE_USER_ROOT)) {
  Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
} else {
  $env:BEYBLADE_USER_ROOT
}
$env:BEYBLADE_INSTALL_ROOT = $installRoot
$env:BEYBLADE_APP_ROOT = $appRoot
$env:BEYBLADE_USER_ROOT = $userRoot
Set-Location -LiteralPath $appRoot

function Normalize-RollbackProcessPath([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  return $value.Trim().Trim('"').Replace('/', '\').ToLowerInvariant()
}

function Remove-StaleRollbackLock([string]$lockPath) {
  try { Remove-Item -LiteralPath $lockPath -Recurse -Force -ErrorAction Stop }
  catch { Throw-LauncherError 'BT-LCH-003' }
}

function Test-RollbackLockActive {
  $lockPath = Join-Path $userRoot 'runtime\rollback.lock'
  if (-not (Test-Path -LiteralPath $lockPath)) { return $false }
  $ownerPath = Join-Path $lockPath 'owner.json'
  try {
    $owner = Get-Content -LiteralPath $ownerPath -Raw -ErrorAction Stop | ConvertFrom-Json
    $ownerPid = 0
    if (-not [int]::TryParse([string]$owner.pid, [ref]$ownerPid) -or $ownerPid -le 0) { return $true }
  } catch {
    # Missing or partially published owner metadata can be an acquisition in
    # progress.  Give atomic publication a bounded grace period, then recover
    # an orphan which can no longer belong to a synchronous acquisition.
    try {
      $lockAge = [DateTime]::UtcNow - (Get-Item -LiteralPath $lockPath -ErrorAction Stop).LastWriteTimeUtc
      if ($lockAge.TotalSeconds -ge 5) {
        Remove-StaleRollbackLock $lockPath
        return $false
      }
    } catch { }
    return $true
  }

  try {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction Stop
  } catch {
    # Unknown process identity fails closed.  A later retry can recover after
    # CIM is available again or the process has exited.
    return $true
  }
  if (-not $processInfo) {
    Remove-StaleRollbackLock $lockPath
    return $false
  }

  $actualExecutable = Normalize-RollbackProcessPath ([string]$processInfo.ExecutablePath)
  $expectedExecutable = Normalize-RollbackProcessPath ([string]$owner.executablePath)
  $commandLine = Normalize-RollbackProcessPath ([string]$processInfo.CommandLine)
  $expectedRunner = Normalize-RollbackProcessPath ([string]$owner.runnerFile)
  if ($actualExecutable -and $expectedExecutable -and $actualExecutable -ne $expectedExecutable) {
    Remove-StaleRollbackLock $lockPath
    return $false
  }
  if ($commandLine -and $expectedRunner -and -not $commandLine.Contains($expectedRunner)) {
    Remove-StaleRollbackLock $lockPath
    return $false
  }
  if (-not $actualExecutable -or -not $expectedExecutable -or -not $commandLine -or -not $expectedRunner) {
    return $true
  }

  try {
    $processStartedAt = ([DateTime]$processInfo.CreationDate).ToUniversalTime()
    $recordedStartedAt = [DateTime]::Parse(
      [string]$owner.startedAt,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    )
  } catch {
    return $true
  }
  $startupDelayMs = ($recordedStartedAt - $processStartedAt).TotalMilliseconds
  if ($startupDelayMs -lt -2000 -or $startupDelayMs -gt 120000) {
    Remove-StaleRollbackLock $lockPath
    return $false
  }
  return $true
}

function Assert-RollbackStartAllowed {
  # This file is installed at {app}, outside versions/<current>.  It is the
  # bootstrap guard for a rollback into a version which predates the JS guard.
  if (Test-RollbackLockActive) { Throw-LauncherError 'BT-LCH-003' }
  $sidecar = Join-Path $userRoot 'runtime\rollback-status.json'
  if (-not (Test-Path -LiteralPath $sidecar)) { return }
  try {
    $record = Get-Content -LiteralPath $sidecar -Raw | ConvertFrom-Json
    $last = $null
    if ($record.events -and $record.events.Count -gt 0) { $last = $record.events[$record.events.Count - 1] }
    $phase = if ($last) { [string]$last.phase } else { [string]$record.status }
    $at = if ($last) { [string]$last.at } else { [string]$record.requestedAt }
    if ($phase -notin @('accepted','running')) { return }
    $when = [DateTime]::Parse($at, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)
    if ($when -gt [DateTime]::UtcNow -or ([DateTime]::UtcNow - $when).TotalMinutes -le 5) {
      Throw-LauncherError 'BT-LCH-003'
    }
  } catch {
    # If an active sidecar cannot be verified, fail closed.  The runner itself
    # is launched before current.json changes and does not come through here.
    Throw-LauncherError 'BT-LCH-003'
  }
}

function Run-Control([string]$command) {
  if ($command -in @('start','restart')) { Assert-RollbackStartAllowed }
  $controlScript = Join-Path $appRoot 'scripts\service-control.js'
  if (-not $NonInteractive) {
    & $node '--no-warnings' $controlScript $command
    if ($LASTEXITCODE -ne 0) { Throw-LauncherError 'BT-LCH-003' }
    return
  }
  $timeout = if ($controlTimeoutSeconds.ContainsKey($command)) { [int]$controlTimeoutSeconds[$command] } else { 60 }
  # Own the process handle directly: Start-Process -PassThru can report a null ExitCode for a hidden child.
  $control = New-Object System.Diagnostics.Process
  $control.StartInfo.FileName = $node
  $control.StartInfo.Arguments = '--no-warnings "' + $controlScript + '" ' + $command
  $control.StartInfo.WorkingDirectory = $appRoot
  $control.StartInfo.UseShellExecute = $false
  $control.StartInfo.CreateNoWindow = $true
  [void]$control.Start()
  try {
    if (-not $control.WaitForExit($timeout * 1000)) {
      try { $control.Kill() } catch { }
      Throw-LauncherError 'BT-LCH-003'
    }
    $exitCode = $control.ExitCode
  } finally { $control.Dispose() }
  if ($exitCode -ne 0) { Throw-LauncherError 'BT-LCH-003' }
}

function Wait-ForManagementPage {
  # This is now the only place a start is declared unsuccessful. service-control reports success
  # for a service it has verified is alive and still starting, so anything genuinely stuck arrives
  # here and is reported as BT-LCH-004 ("waited, never answered") rather than BT-LCH-003's false
  # claim that the start failed. The budget is the margin on top of service-control's own 60s.
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    try { if ((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2).StatusCode -eq 200) { return } }
    catch { Start-Sleep -Milliseconds 500 }
  }
  Throw-LauncherError 'BT-LCH-004'
}

switch ($Action) {
  'open' { Run-Control 'start'; Wait-ForManagementPage; try { Start-Process 'http://127.0.0.1:8787' } catch { Throw-LauncherError 'BT-LCH-005' } }
  'start' { Run-Control 'start'; Wait-ForManagementPage }
  'restart' { Run-Control 'restart'; Wait-ForManagementPage }
  'stop' { Run-Control 'stop' }
  'status' { Run-Control 'status'; if (-not $NonInteractive) { Read-Host '按 Enter 關閉' } }
  'export' {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Filter = 'Beyblade Tracker 移機檔 (*.beyblade-transfer)|*.beyblade-transfer'
    $dialog.FileName = "beyblade-transfer-$((Get-Date).ToString('yyyyMMdd-HHmmss')).beyblade-transfer"
    if ($dialog.ShowDialog() -eq 'OK') { & $node '--no-warnings' (Join-Path $appRoot 'bin\export.js') '--out' $dialog.FileName }
  }
  'import' {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = 'Beyblade Tracker 移機檔 (*.beyblade-transfer)|*.beyblade-transfer'
    if ($dialog.ShowDialog() -eq 'OK') {
      & $node '--no-warnings' (Join-Path $appRoot 'bin\import.js') '--from' $dialog.FileName
      if ($LASTEXITCODE -eq 0) { Run-Control 'restart' }
    }
  }
  'update' { & $node '--no-warnings' (Join-Path $appRoot 'bin\update.js') }
  'rollback' { Run-Control 'stop'; & $node '--no-warnings' (Join-Path $appRoot 'bin\rollback.js') }
}
} catch {
  $code = $_.Exception.Data['BeybladeCode']
  if ($code -notmatch '^BT-LCH-00[1-6]$') { $code = 'BT-LCH-999' }
  # Non-interactive callers get only the safe error code on stderr: no dialog, no paths, no stack trace.
  if ($NonInteractive) {
    [Console]::Error.WriteLine($code)
    exit 1
  }
  Show-LauncherError $code
  exit 1
}
exit 0
