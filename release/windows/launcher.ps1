param([ValidateSet('open','start','restart','stop','status','export','import','update','rollback')][string]$Action='open')
$ErrorActionPreference = 'Stop'
$installRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$currentPath = Join-Path $installRoot 'current.json'
if (-not (Test-Path -LiteralPath $currentPath)) { throw '找不到目前安裝版本。請重新安裝 Beyblade Tracker。' }
$version = (Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json).version
$appRoot = Join-Path (Join-Path $installRoot 'versions') $version
$node = Join-Path $appRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw "找不到版本 $version 的執行環境。" }
$userRoot = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$env:BEYBLADE_INSTALL_ROOT = $installRoot
$env:BEYBLADE_APP_ROOT = $appRoot
$env:BEYBLADE_USER_ROOT = $userRoot
Set-Location -LiteralPath $appRoot

function Run-Control([string]$command) {
  & $node '--no-warnings' (Join-Path $appRoot 'scripts\service-control.js') $command
  if ($LASTEXITCODE -ne 0) { throw "服務操作失敗：$command" }
}

switch ($Action) {
  'open' { Run-Control 'start'; Start-Process 'http://127.0.0.1:8787' }
  'start' { Run-Control 'start' }
  'restart' { Run-Control 'restart' }
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
