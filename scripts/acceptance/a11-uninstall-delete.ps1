# A-11：解除安裝並選擇「刪除資料」。⚠ 破壞性 —— 會永久刪除本帳號的追蹤資料。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\a11-uninstall-delete.ps1
#
# 前置：必須已重新安裝 Beyblade Tracker（A-10 已把它移除）。

$out  = (Join-Path $PSScriptRoot 'a11-result.txt')
$dest = $PSScriptRoot
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir  = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Beyblade Tracker'
$safety = Join-Path $dest 'a11-safety-copy'

Log ("=== A-11 解除安裝（刪除資料）  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

if (-not (Test-Path -LiteralPath $appDir)) {
  Log '>>> 尚未安裝。請先執行安裝器重新安裝，再跑本腳本：'
  Log ("    " + (Join-Path $dest 'BeybladeTracker-1.0.0-Setup.exe'))
  Log ''
  Log ("完成，結果已寫入 " + $out)
  exit 1
}

Log '########## 刪除前 ##########'
Log ("安裝目錄存在   : " + (Test-Path -LiteralPath $appDir))
Log ("開始功能表捷徑 : " + (Test-Path -LiteralPath $startMenu))
Log ("使用者資料存在 : " + (Test-Path -LiteralPath $userDir))
Log ''
if (Test-Path -LiteralPath $userDir) {
  Log '使用者資料內容：'
  Get-ChildItem -LiteralPath $userDir -Recurse -File -ErrorAction SilentlyContinue |
    ForEach-Object { Log ("    {0,-46} {1,10}" -f $_.FullName.Replace($userDir, '...'), $_.Length) }
}

Log ''
Log '--- 安全備份（本測試為破壞性，先留一份以防意外）---'
if (Test-Path -LiteralPath $safety) { Remove-Item -LiteralPath $safety -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $userDir) {
  Copy-Item -LiteralPath $userDir -Destination $safety -Recurse -Force -ErrorAction SilentlyContinue
  $n = @(Get-ChildItem -LiteralPath $safety -Recurse -File -ErrorAction SilentlyContinue).Count
  Log ("已備份 $n 個檔案到 : $safety")
  Log '（此備份僅供意外時還原；A-11 驗收本身不依賴它。驗完可自行刪除。）'
}

Log ''
Log '======================================================================'
Log ' 請開啟「設定 → 應用程式 → 已安裝的應用程式」，解除安裝 Beyblade Tracker。'
Log ''
Log ' ⚠⚠ 這一次，資料保留提示請選「否」（永久刪除使用者資料）。'
Log ''
Log ' 這是整份清單中唯一從未被執行過的路徑：自動化測試因 /SUPPRESSMSGBOXES'
Log ' 一律取得預設值「是」，因此 DelTree 分支從未執行。'
Log '======================================================================'
Read-Host '解除安裝完成後按 Enter'

# 提早按 Enter 會讓下方檢查在解除安裝之前就量測；更糟的是若在此中斷腳本，
# 結果檔會停在提示這一行、完全沒有「刪除後」段落，等於整項驗收沒有證據
# （2026-08-11 就這樣發生過）。所以這裡等安裝目錄真的消失，而不是相信那個 Enter。
if (Test-Path -LiteralPath $appDir) {
  Write-Host '安裝目錄仍在。若解除安裝精靈還開著請完成它；若尚未開始，請現在執行。' -ForegroundColor Yellow
  Write-Host '最多等待 5 分鐘…請勿關閉本視窗，否則本項驗收不會留下任何證據。' -ForegroundColor Yellow
  for ($w = 0; $w -lt 60 -and (Test-Path -LiteralPath $appDir); $w++) { Start-Sleep -Seconds 5 }
}
if (Test-Path -LiteralPath $appDir) {
  Log ''
  Log '>>> 等待逾時：安裝目錄仍然存在。這代表解除安裝未執行或未完成，'
  Log '>>> 而不是「刪除後檢查失敗」。下方檢查不具參考價值，請重跑本腳本。'
}

Start-Sleep -Seconds 3
Log ''
Log '########## 刪除後 ##########'
$appGone  = -not (Test-Path -LiteralPath $appDir)
$menuGone = -not (Test-Path -LiteralPath $startMenu)
$dataGone = -not (Test-Path -LiteralPath $userDir)
$run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).BeybladeTracker
$uninst = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like '*Beyblade*' }

Log ("安裝目錄已移除       : $appGone")
Log ("開始功能表已移除     : $menuGone")
Log ("Run 機碼已移除       : " + (-not $run))
Log ("解除安裝登錄已移除   : " + (-not $uninst))
Log ("**使用者資料已刪除** : $dataGone")
if (-not $dataGone) {
  Log '>>> FAIL：使用者資料目錄仍存在，殘留內容：'
  Get-ChildItem -LiteralPath $userDir -Recurse -File -ErrorAction SilentlyContinue |
    ForEach-Object { Log ("    " + $_.FullName.Replace($userDir, '...') + "  " + $_.Length) }
}

$listen = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
Log ("8787 監聽 : " + $(if ($listen) { '>>> 仍在監聽（異常）' } else { '已停止' }))

Log ''
if ($appGone -and $menuGone -and $dataGone -and -not $run -and -not $uninst) {
  Log '=== A-11 判定：PASS ==='
} else {
  Log '=== A-11 判定：FAIL ==='
}

Log ''
Log '下一步（A-7 匯入側）：'
Log '  1. 重新執行安裝器安裝'
Log '  2. 由開始功能表「匯入／移機」選取先前匯出的 .beyblade-transfer'
Log '  3. 匯入後應還原 products 1 / offers 2 / events 1 / sources 3 / observations 514'
Log ''
Log ("完成，結果已寫入 " + $out)
