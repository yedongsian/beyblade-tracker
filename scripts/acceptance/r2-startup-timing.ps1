# 量測本次啟動實際耗時，判斷 BT-LCH-003 是否為逾時誤報。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\r2-startup-timing.ps1

$out = (Join-Path $PSScriptRoot 'r2-timing-result.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$appDir  = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'

Log ("=== 第二輪 啟動耗時  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

Log '--- tracker.log 最後 30 行（含本次安裝後的啟動）---'
$tl = Join-Path $userDir 'logs\tracker.log'
if (Test-Path -LiteralPath $tl) {
  Get-Content -LiteralPath $tl -Tail 30 -Encoding UTF8 | ForEach-Object { Log ("    " + $_) }
} else { Log '    找不到 tracker.log' }

Log ''
Log '--- 關鍵時間戳 ---'
$appVer = Join-Path $appDir 'versions\1.0.0'
if (Test-Path -LiteralPath $appVer) { Log ("安裝目錄建立 : " + (Get-Item -LiteralPath $appVer).CreationTime.ToString('HH:mm:ss')) }
$cj = Join-Path $appDir 'current.json'
if (Test-Path -LiteralPath $cj) { Log ("current.json 寫入（安裝完成、[Run] 啟動服務） : " + (Get-Item -LiteralPath $cj).LastWriteTime.ToString('HH:mm:ss')) }
$sf = Join-Path $userDir 'runtime\tracker-status.json'
if (Test-Path -LiteralPath $sf) {
  $st = Get-Content -LiteralPath $sf -Raw -Encoding UTF8 | ConvertFrom-Json
  Log ("服務 startedAt : " + ([DateTime]::Parse($st.startedAt).ToLocalTime().ToString('HH:mm:ss')))
  Log ("服務 status    : " + $st.status + "  PID " + $st.pid)
  if (Test-Path -LiteralPath $cj) {
    $delta = ([DateTime]::Parse($st.startedAt).ToLocalTime() - (Get-Item -LiteralPath $cj).LastWriteTime).TotalSeconds
    Log ("安裝完成到服務就緒 : {0:N1} 秒" -f $delta)
    Log ''
    # 第四版產物起，逾時不再等同啟動失敗：service-control 逾時後會先向服務取證
    # （狀態檔的擁有者與階段、/health），確認確實沒起來才回報失敗。所以下面這些
    # 門檻只用來說明「使用者要等多久」，不再是成敗判定。
    Log 'launcher.ps1 的上限：start=90 秒、restart=130 秒；其驅動的 service-control start 預算為 60 秒。'
    if ($delta -gt 60) {
      Log ('  >>> 已超過 service-control 的 60 秒預算 —— 此時會回報 still-starting（非失敗），')
      Log ('      再由 Wait-ForManagementPage 決定是否為 BT-LCH-004。請確認畫面上是否出現對話框。')
    } else {
      Log ('  未超過 60 秒預算，屬正常啟動範圍，不應出現任何 BT-LCH-* 對話框。')
    }
  }
}

Log ''
Log '--- 還原前資料庫（applyPendingTransfer 會保留一份）---'
$dataDir = Join-Path $userDir 'data'
$before = @(Get-ChildItem -LiteralPath $dataDir -Filter '*before-restore*' -ErrorAction SilentlyContinue)
if ($before) { foreach ($b in $before) { Log ("    " + $b.Name + "  " + $b.Length.ToString('N0') + " bytes  " + $b.LastWriteTime.ToString('HH:mm:ss')) } }
else { Log '    無 before-restore 檔' }
Log '    （存在即證明 applyPendingTransfer 確實執行過還原）'

Log ''
Log '--- 目前服務是否正常 ---'
try {
  $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
  Log ("/health : " + $h.status + "  version=" + $h.release.version)
} catch { Log ("/health 連不上：" + $_.Exception.Message) }

Log ''
Log '--- 是否有殘留的 launcher 行程 ---'
$lch = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'launcher\.ps1' }
if ($lch) {
  foreach ($x in $lch) {
    $when = if ($x.CreationDate) { ([DateTime]$x.CreationDate).ToString('HH:mm:ss') } else { '不明' }
    Log ("    PID " + $x.ProcessId + "  啟動 " + $when)
  }
  Log '    （若對話框已關閉仍殘留，代表關閉後未正常結束）'
} else { Log '    無殘留（對話框關閉後行程已正常結束 —— D-4 修正的另一項佐證）' }

Log ''
Log ("完成，結果已寫入 " + $out)
