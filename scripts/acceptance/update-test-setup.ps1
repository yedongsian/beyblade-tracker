# 更新流程驗收：設定與前置檢查。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\update-test-setup.ps1
#
# 這一步原本寫在文件裡要人複製貼上，但多行的 PEM 公鑰不適合手動貼進主控台。
# 改為腳本：設定兩個環境變數、逐項驗證、並印出下一步。

$out = (Join-Path $PSScriptRoot 'update-test-setup.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$manifestUrl = 'https://github.com/yedongsian/beyblade-tracker/releases/download/v1.0.1/release-manifest.json'
$keyFile     = Join-Path $PSScriptRoot 'manifest-public-key.pem'
$appDir      = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'

Log ("=== 更新流程驗收 前置設定  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

# --- 1. 目前安裝的版本必須是 1.0.0，否則測不出「發現新版」---
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
if ($installed -eq '1.0.1') {
  Log '>>> 已經是 1.0.1，無法測試「從舊版發現新版」。請還原 S1-with-chrome 快照後重跑。'
  Log ''
  Log ("完成，結果已寫入 " + $out)
  exit 1
}
if ($installed -ne '1.0.0') { Log ">>> 預期為 1.0.0，實得 $installed。請確認還原的是哪個快照。" }

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
