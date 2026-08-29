# A-7（匯入側）：把先前匯出的移機檔匯入乾淨環境，驗證資料完整還原。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\a7-import.ps1
#
# 前置：A-11 已清空資料，且已重新安裝 Beyblade Tracker。


# 版本不寫死：先讀已安裝的 current.json，讀不到就取 versions 下的第一個目錄。
# 2026-08-29 升 1.0.1 前，這些腳本共有 17 處寫死的 1.0.0，升版會全部失效。
$btInstallRoot = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$installedVersion = $(try { (Get-Content -LiteralPath (Join-Path $btInstallRoot 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { $null })
if (-not $installedVersion) { $installedVersion = (Get-ChildItem -LiteralPath (Join-Path $btInstallRoot 'versions') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1).Name }

$out  = (Join-Path $PSScriptRoot 'a7-import-result.txt')
$dest = $PSScriptRoot
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir  = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$db      = Join-Path $userDir 'data\tracker.db'
$node    = Join-Path $appDir "versions\$installedVersion\runtime\node.exe"
if (-not (Test-Path -LiteralPath $node)) { $node = 'C:\Program Files\nodejs\node.exe' }

# 注意：參數不可命名為 $Args —— 那是 PowerShell 的自動變數，展開後會是空的，
# 會導致 node 在沒有參數的情況下進入 REPL 並吃掉後續輸入。
function Run-Node([string]$Script, [string]$Argument) {
  $prev = [Console]::OutputEncoding
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  try { return & $node $Script $Argument } finally { [Console]::OutputEncoding = $prev }
}

Log ("=== A-7 匯入側  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

if (-not (Test-Path -LiteralPath $appDir)) {
  Log '>>> 尚未安裝。請先重新安裝後再跑本腳本。'
  exit 1
}

$bundle = @(Get-ChildItem -LiteralPath $dest -Filter '*.beyblade-transfer' | Sort-Object LastWriteTime -Descending)[0]
if (-not $bundle) { Log '>>> 找不到 .beyblade-transfer 移機檔。'; exit 1 }
Log ("移機檔 : " + $bundle.Name)

Log ''
Log '--- 基準：移機檔內部的資料庫筆數 ---'
Run-Node (Join-Path $dest 'bundle-counts.mjs') $bundle.FullName | ForEach-Object { Log ("    " + $_) }

Log ''
Log '--- 匯入前：目前安裝的資料庫狀態（應為全新空庫）---'
if (Test-Path -LiteralPath $db) {
  Run-Node (Join-Path $dest 'db-counts.mjs') $db | ForEach-Object { Log ("    " + $_) }
} else { Log '    tracker.db 尚未建立（服務可能還沒啟動）' }

Log ''
Log '======================================================================'
Log ' 請點開始功能表的「匯入／移機」捷徑，選取這個檔案：'
Log ("   " + $bundle.FullName)
Log ''
Log ' 匯入後服務會自動重新啟動，請稍候片刻再回來。'
Log '======================================================================'
Read-Host '匯入完成後按 Enter'

Log ''
Log '--- 等待服務恢復 ---'
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try {
    $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
    Log ("第 ${i} 秒 /health : " + $h.status)
    $ok = $true
    break
  } catch { }
}
if (-not $ok) { Log '>>> 60 秒內服務未恢復' }

Log ''
Log '--- 匯入後：資料庫筆數（應與移機檔基準相符）---'
if (Test-Path -LiteralPath $db) {
  Run-Node (Join-Path $dest 'db-counts.mjs') $db | ForEach-Object { Log ("    " + $_) }
} else { Log '>>> FAIL：tracker.db 不存在' }

Log ''
Log '--- 來源設定是否一併還原 ---'
$src = Join-Path $userDir 'config\sources.json'
if (Test-Path -LiteralPath $src) {
  $keys = ([regex]::Matches((Get-Content -LiteralPath $src -Raw -Encoding UTF8), '"key"\s*:\s*"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
  Log ("sources.json 來源 : " + ($keys -join ', '))
} else { Log '>>> sources.json 不存在' }

Log ''
Log '--- 憑證應未被還原（移機檔不含 secrets）---'
$sec = Join-Path $userDir 'config\secrets.json'
Log ("secrets.json 存在 : " + (Test-Path -LiteralPath $sec) + "  （預期 False：通知憑證需重新設定）")

Log ''
Log '判定要點：匯入後 products / offers / events / sources 應與移機檔基準完全相同。'
Log '          observations 可能略多於基準 —— 服務重啟後會立即執行一次掃描並寫入新的觀測，'
Log '          只要不少於基準即為正常。'
Log ''
Log ("完成，結果已寫入 " + $out)
