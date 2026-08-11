# A-7（匯出側）：由開始功能表捷徑匯出移機檔，並驗證其完整性與安全性。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\a7-export.ps1
#
# 匯入側留待稍後：A-11 會清空使用者資料，屆時再匯入才能驗證「跨乾淨環境還原」。

$out = (Join-Path $PSScriptRoot 'a7-result.txt')
$dest = $PSScriptRoot
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$node = Join-Path $appDir 'versions\1.0.0\runtime\node.exe'
$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'

Log ("=== A-7 匯出側  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

Log '--- 匯出前的使用者資料 ---'
$db = Join-Path $userDir 'data\tracker.db'
if (Test-Path -LiteralPath $db) {
  Log ("tracker.db      : " + (Get-Item -LiteralPath $db).Length.ToString('N0') + " bytes")
  Log ("sha256          : " + (Get-FileHash -LiteralPath $db -Algorithm SHA256).Hash.ToLower())
} else { Log '>>> 找不到 tracker.db，無法匯出' }

$before = @(Get-ChildItem -LiteralPath $dest -Filter '*.beyblade-transfer' -ErrorAction SilentlyContinue)
Log ("匯出前既有移機檔 : " + $before.Count + " 個")

Log ''
Log '======================================================================'
Log ' 請點開始功能表的「匯出／移機」捷徑。'
Log ''
Log " 在另存新檔對話框中，把檔案存到這個資料夾："
Log "   $dest"
Log ' 檔名可用預設值。存好後回到本視窗。'
Log '======================================================================'
Read-Host '完成匯出後按 Enter'

$after = @(Get-ChildItem -LiteralPath $dest -Filter '*.beyblade-transfer' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending)
Log ''
if ($after.Count -le $before.Count) {
  Log '>>> FAIL：在目標資料夾找不到新的 .beyblade-transfer 檔案。'
  Log '    可能是對話框未出現（參見缺陷 D-4）、你取消了、或存到了別的位置。'
  Log ''
  Log '--- 是否有卡住的隱藏 launcher 行程（D-4 徵兆）---'
  $stuck = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'launcher\.ps1' }
  if ($stuck) { foreach ($p in $stuck) { Log ("    PID " + $p.ProcessId + " : " + $p.CommandLine) } } else { Log '    無' }
  Log ''
  Log ("完成，結果已寫入 " + $out)
  exit 1
}

$bundle = $after[0]
Log ("新匯出的移機檔 : " + $bundle.Name)
Log ("建立時間       : " + $bundle.LastWriteTime.ToString('o'))
Log ''
Log '--- 移機檔驗證 ---'

if (-not (Test-Path -LiteralPath $node)) {
  Log ">>> 找不到內建 node：$node，跳過內容驗證"
} else {
  $verifier = Join-Path $dest 'verify-transfer.js'
  # node 以 UTF-8 輸出；PS 5.1 預設以主控台編碼讀取 native 程式輸出，不改會變亂碼。
  $prevEncoding = [Console]::OutputEncoding
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  try { $result = & $node $verifier $bundle.FullName } finally { [Console]::OutputEncoding = $prevEncoding }
  $code = $LASTEXITCODE
  $result | ForEach-Object { Log ("  " + $_) }
  Log ''
  Log ("驗證程式離開代碼 : $code")
}

Log ''
Log '--- 匯出後使用者資料是否未被更動 ---'
if (Test-Path -LiteralPath $db) {
  Log ("tracker.db sha256 : " + (Get-FileHash -LiteralPath $db -Algorithm SHA256).Hash.ToLower())
  Log '（與匯出前比對；匯出為唯讀操作，理應相同。若不同請檢查是否掃描剛好寫入。）'
}

Log ''
Log '移機檔已留在共用資料夾，供稍後 A-7 匯入側使用，請勿刪除。'
Log ("完成，結果已寫入 " + $out)
