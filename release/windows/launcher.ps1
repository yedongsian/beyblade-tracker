param([ValidateSet('open','start','restart','stop','status','export','import','update','rollback')][string]$Action='open')
$ErrorActionPreference = 'Stop'

function Throw-LauncherError([string]$Code) {
  $error = New-Object System.Exception($Code)
  $error.Data['BeybladeCode'] = $Code
  throw $error
}

function Show-LauncherError([string]$Code) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $details = @{
    'BT-LCH-001' = @('找不到目前版本', 'Beyblade Tracker 找不到目前安裝版本。', '重新安裝相同或更新版本。')
    'BT-LCH-002' = @('找不到執行環境', 'Beyblade Tracker 找不到內建執行環境。', '重新安裝，並檢查防毒軟體是否隔離檔案。')
    'BT-LCH-003' = @('背景服務啟動失敗', 'Beyblade Tracker 無法完成背景服務啟動。', '查看服務狀態後，稍後再試一次。')
    'BT-LCH-004' = @('等待服務逾時', 'Beyblade Tracker 等待服務回應逾時。', '等候一分鐘後再試，並確認 8787 port 未被其他程式占用。')
    'BT-LCH-005' = @('無法開啟管理頁', '背景服務已啟動，但無法開啟本機管理頁。', '稍後再試，或查看服務狀態。')
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
  $report.Add_Click({ $body = [uri]::EscapeDataString("錯誤代碼：$Code`r`nApp version：$appVersion`r`nSupport reference：$supportRef`r`n`r`n送出前請確認未包含 Token、Webhook、資料庫、完整 log、URL 或路徑。"); Start-Process "https://github.com/yedongsian/beyblade-tracker/issues/new/choose?title=%5B$Code%5D%20Beyblade%20Tracker&body=$body" })
  $status = New-Object System.Windows.Forms.Button
  $status.Text = '服務狀態'; $status.Location = New-Object System.Drawing.Point(271, 220); $status.Size = New-Object System.Drawing.Size(100, 32)
  $status.Add_Click({ Start-Process 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Action status" })
  $close = New-Object System.Windows.Forms.Button
  $close.Text = '關閉'; $close.Location = New-Object System.Drawing.Point(382, 220); $close.Size = New-Object System.Drawing.Size(90, 32); $close.Add_Click({ $form.Close() })
  $form.Controls.AddRange(@($label, $copy, $report, $status, $close)); $form.ShowDialog() | Out-Null
}

try {
$installRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$currentPath = Join-Path $installRoot 'current.json'
if (-not (Test-Path -LiteralPath $currentPath)) { Throw-LauncherError 'BT-LCH-001' }
try { $version = (Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json).version } catch { Throw-LauncherError 'BT-LCH-001' }
if ([string]::IsNullOrWhiteSpace($version)) { Throw-LauncherError 'BT-LCH-001' }
$appRoot = Join-Path (Join-Path $installRoot 'versions') $version
$node = Join-Path $appRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $node)) { Throw-LauncherError 'BT-LCH-002' }
$userRoot = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$env:BEYBLADE_INSTALL_ROOT = $installRoot
$env:BEYBLADE_APP_ROOT = $appRoot
$env:BEYBLADE_USER_ROOT = $userRoot
Set-Location -LiteralPath $appRoot

function Run-Control([string]$command) {
  & $node '--no-warnings' (Join-Path $appRoot 'scripts\service-control.js') $command
  if ($LASTEXITCODE -ne 0) { Throw-LauncherError 'BT-LCH-003' }
}

function Wait-ForManagementPage {
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
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
  'status' { Run-Control 'status'; Read-Host '按 Enter 關閉' }
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
  if ($code -notmatch '^BT-LCH-00[1-5]$') { $code = 'BT-LCH-999' }
  Show-LauncherError $code
}
