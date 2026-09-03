# 更新流程驗收：設定與前置檢查。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\update-test-setup.ps1
#
# 這一步原本寫在文件裡要人複製貼上，但多行的 PEM 公鑰不適合手動貼進主控台。
# 改為腳本：設定兩個環境變數、逐項驗證、並印出下一步。

$out = (Join-Path $PSScriptRoot 'update-test-setup.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

# 這一輪的版本從 update-test-round.json 讀，不寫死在腳本裡。
# README 早就寫過這條規則，這裡卻連續三輪手動同步版本號。
$roundFile = Join-Path $PSScriptRoot 'update-test-round.json'
if (-not (Test-Path -LiteralPath $roundFile)) { Write-Host ">>> 找不到 $roundFile"; exit 1 }
# -Encoding UTF8 不可省略：PowerShell 5.1 預設以 ANSI 讀檔，JSON 裡的中文會變亂碼
# 而讓 ConvertFrom-Json 以「Unterminated string」失敗（BT-P1-003 的同一個坑，這次在資料檔上）。
$round = Get-Content -LiteralPath $roundFile -Raw -Encoding UTF8 | ConvertFrom-Json
$fromVersion   = $round.from
$targetVersion = $round.target

$manifestUrl = "https://github.com/yedongsian/beyblade-tracker/releases/download/v$targetVersion/release-manifest.json"
$keyFile     = Join-Path $PSScriptRoot 'manifest-public-key.pem'
$appDir      = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'

Log ("=== 更新流程驗收 前置設定  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

# --- 1. 目前安裝的版本必須是 $fromVersion，否則測不出「發現新版」---
Log '--- 1. 目前安裝的版本 ---'
$currentPath = Join-Path $appDir 'current.json'
if (-not (Test-Path -LiteralPath $currentPath)) {
  Log ">>> 找不到 $currentPath —— 尚未安裝，或還原到了沒有安裝的快照。"
  Log '    請先還原 S1-with-chrome 快照。'
  Log ''
  Log ("完成，結果已寫入 " + $out)
  exit 1
}
$installed = (Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json).version
Log ("current.json : $installed")
if ($installed -eq $targetVersion) {
  Log ">>> 已經是 $targetVersion，無法測試「從舊版發現新版」。請重做步驟 1。"
  Log ''
  Log ("完成，結果已寫入 " + $out)
  exit 1
}
if ($installed -ne $fromVersion) { Log ">>> 預期為 $fromVersion，實得 $installed。請先依步驟 1 裝上 $fromVersion。" }

# 「檔案是新版、服務仍是舊版」正是 BT-REL-001 的樣子。若帶著這個狀態往下走，
# 更新後的判定會完全無法區分「這一輪失敗」與「上一輪的殘留」（2026-08-29 就這樣浪費一輪）。
$servedNow = $(try { (Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 8 -ErrorAction Stop).release.version } catch { $null })
if (-not $servedNow) {
  Log '服務目前無回應（尚未啟動）—— 這在剛安裝完是正常的。'
} elseif ($servedNow -ne $installed) {
  Log ">>> 服務實際在跑 $servedNow，但 current.json 是 $installed。"
  Log '>>> 這是上一輪失敗更新留下的髒狀態，不是乾淨的起點。'
  Log '>>> 請還原 S1-with-chrome 快照，重新安裝 1.0.1 後再跑一次本腳本。'
  Log ''
  Log ("完成，結果已寫入 " + $out)
  exit 1
} else {
  Log "服務實際在跑 : $servedNow（與 current.json 一致）"
}

# --- 2. 公鑰檔 ---
Log ''
Log '--- 2. 簽章公鑰 ---'
if (-not (Test-Path -LiteralPath $keyFile)) {
  Log ">>> 找不到 $keyFile"
  Log '    請確認共用資料夾已同步（主機端 BeybladeTracker-VM-Round）。'
  Log ''
  Log ("完成，結果已寫入 " + $out)
  exit 1
}
$key = Get-Content -LiteralPath $keyFile -Raw
if ($key -notmatch 'BEGIN PUBLIC KEY') { Log '>>> 這個檔案看起來不是公鑰，停止。'; exit 1 }
if ($key -match 'PRIVATE') { Log '>>> 檔案含私鑰材料，停止。絕不可把私鑰放進共用資料夾。'; exit 1 }
Log ("公鑰檔 : $keyFile（" + $key.Length + " 字元）")

# --- 3. 寫入環境變數 ---
Log ''
Log '--- 3. 寫入使用者環境變數 ---'
[Environment]::SetEnvironmentVariable('UPDATE_MANIFEST_URL', $manifestUrl, 'User')
[Environment]::SetEnvironmentVariable('UPDATE_PUBLIC_KEY', $key, 'User')

# --- 4. 讀回來驗證，不相信「有設就一定對」---
Log ''
Log '--- 4. 讀回驗證 ---'
$readUrl = [Environment]::GetEnvironmentVariable('UPDATE_MANIFEST_URL', 'User')
$readKey = [Environment]::GetEnvironmentVariable('UPDATE_PUBLIC_KEY', 'User')
$urlOk = $readUrl -eq $manifestUrl
$keyLines = ($readKey -split "`n").Count
$keyOk = ($readKey -match 'BEGIN PUBLIC KEY') -and ($readKey -match 'END PUBLIC KEY') -and ($keyLines -ge 3)

Log ("UPDATE_MANIFEST_URL : " + $(if ($urlOk) { '正確' } else { '>>> 不符：' + $readUrl }))
Log ("UPDATE_PUBLIC_KEY   : " + $(if ($keyOk) { "正確（$keyLines 行，含 BEGIN／END）" } else { ">>> 有問題（$keyLines 行）—— 換行可能遺失，公鑰將無法驗簽" }))

Log ''
if ($urlOk -and $keyOk) {
  Log '=== 前置設定完成 ==='
  Log ''
  Log '下一步（環境變數只對新啟動的行程生效，所以服務一定要重開）：'
  Log '  1. 開始功能表 →「停止背景追蹤」'
  Log '  2. 開始功能表 →「Beyblade Tracker」'
  Log '  3. 等服務就緒（VM 上約 30～60 秒），然後回到 UPDATE-TEST.md 的步驟 4'
} else {
  Log '=== 前置設定未完成，請勿繼續 ==='
  Log '上面標示 >>> 的項目要先解決；帶著錯誤往下走只會得到 BT-UPD-003。'
}

Log ''
Log ("完成，結果已寫入 " + $out)
