# 在「測試帳號」執行：先做前置診斷，再帶 log 啟動安裝器，最後回報離開代碼。
# 安裝精靈會正常出現，請照 A-1 全程使用預設值完成。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\install-with-log.ps1

$base      = $PSScriptRoot
$installer = Join-Path $base ((Get-ChildItem -LiteralPath $base -Filter 'BeybladeTracker-*-Setup.exe' | Select-Object -First 1).Name)
$log       = Join-Path $base 'install-testdarren.log'

Write-Host '=== 前置診斷 ===' -ForegroundColor Cyan
Write-Host ("使用者        : $env:USERNAME")
Write-Host ("安裝器存在    : " + (Test-Path -LiteralPath $installer))
if (-not (Test-Path -LiteralPath $installer)) { Write-Host '找不到安裝器，停止。' -ForegroundColor Red; exit 1 }

$item = Get-Item -LiteralPath $installer
Write-Host ("大小          : " + $item.Length + " bytes")
Write-Host ("SHA-256       : " + (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLower())

# Mark-of-the-Web：有這個資料流才會觸發 SmartScreen 的下載檔案警告。
$motw = Get-Item -LiteralPath $installer -Stream Zone.Identifier -ErrorAction SilentlyContinue
if ($motw) {
  Write-Host 'MOTW          : 有（此檔被標記為從網路取得，SmartScreen 可能攔截）' -ForegroundColor Yellow
  Get-Content -LiteralPath $installer -Stream Zone.Identifier | ForEach-Object { Write-Host ("  " + $_) }
} else {
  Write-Host 'MOTW          : 無（本機檔案，通常不會觸發 SmartScreen 下載警告）'
}

# 讀取權限實測
try { [System.IO.File]::OpenRead($installer).Close(); Write-Host '讀取權限      : OK' }
catch { Write-Host ("讀取權限      : 失敗 - " + $_.Exception.Message) -ForegroundColor Red }

Write-Host ''
Write-Host '=== 啟動安裝器 ===' -ForegroundColor Cyan
Write-Host '安裝精靈即將出現。請全程使用預設值完成安裝（A-1）。'
Write-Host '若出現「Windows 已保護您的電腦」，請點「更多資訊」→「仍要執行」。'
Write-Host '若出現任何其他警告或錯誤，請先截圖再繼續。'
Write-Host ''

if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }

try {
  $p = Start-Process -FilePath $installer -ArgumentList ("/LOG=`"$log`"") -PassThru -ErrorAction Stop
  try { $null = $p.Handle } catch { }
  Write-Host ("安裝器 PID    : " + $p.Id)
  Write-Host '等待安裝完成…（請操作精靈）'
  $p.WaitForExit()
  $code = $p.ExitCode
} catch {
  Write-Host ('啟動失敗: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}

$meaning = switch ($code) {
  0 { '成功完成' }
  1 { '初始化失敗或命令列無效' }
  2 { '使用者在安裝開始前按了取消' }
  3 { '準備階段發生嚴重錯誤' }
  4 { '安裝過程發生嚴重錯誤' }
  5 { '使用者在安裝過程中按了取消／中止' }
  6 { '安裝程序被外部終止' }
  7 { '準備階段判定無法繼續' }
  8 { '準備階段判定無法繼續，需要重新開機' }
  default { '未知代碼' }
}

Write-Host ''
Write-Host '=== 結果 ===' -ForegroundColor Cyan
Write-Host ("離開代碼      : $code  ($meaning)") -ForegroundColor $(if ($code -eq 0) { 'Green' } else { 'Yellow' })
Write-Host ("log 是否產生  : " + (Test-Path -LiteralPath $log))
if (Test-Path -LiteralPath $log) { Write-Host ("log 大小      : " + (Get-Item -LiteralPath $log).Length + " bytes") }
Write-Host ''
Write-Host '接著請執行蒐證：' -ForegroundColor Cyan
Write-Host ("  powershell -NoProfile -ExecutionPolicy Bypass -File " + (Join-Path $PSScriptRoot 'collect-evidence.ps1') + " -Label 安裝後")
