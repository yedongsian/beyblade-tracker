# 更新流程驗收的選單。
#
# 選單為什麼在 PowerShell 而不在 .cmd：cmd.exe 以位元組位移在批次檔中定位，
# 一旦 chcp 65001 之下夾雜多位元組中文，行會被切斷、殘片被當成指令執行
# （2026-08-29 實測：[3][4][7] 三項整個消失）。.cmd 現在只剩純 ASCII 的一行轉呼叫。

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

$items = [ordered]@{
  '1' = @{ 名稱 = '步驟 2 - 前置設定（檢查版本與公鑰、設定環境變數）'; 腳本 = 'update-test-setup.ps1';    參數 = @() }
  '2' = @{ 名稱 = '步驟 6 - 記錄「更新前」的版本與資料筆數';           腳本 = 'update-test-check.ps1';    參數 = @('-Label', '更新前') }
  '3' = @{ 名稱 = '步驟 7 - 記錄「更新後」的版本與資料筆數';           腳本 = 'update-test-check.ps1';    參數 = @('-Label', '更新後') }
  '4' = @{ 名稱 = '步驟 8 - 回滾到 1.0.0';                              腳本 = 'update-test-rollback.ps1'; 參數 = @() }
  '5' = @{ 名稱 = '步驟 8 - 記錄「回滾後」的版本與資料筆數';           腳本 = 'update-test-check.ps1';    參數 = @('-Label', '回滾後') }
  '6' = @{ 名稱 = '診斷：更新後版本對不上（current.json 與 /health 不同）'; 腳本 = 'update-test-diagnose.ps1'; 參數 = @() }
  '7' = @{ 名稱 = '診斷：手動重啟（分辨重啟壞掉 vs 安裝器沒觸發）';    腳本 = 'update-test-restart.ps1';  參數 = @() }
  '8' = @{ 名稱 = '診斷：launcher restart 卡在哪一層（分層執行並攤開輸出）'; 腳本 = 'update-test-launcher.ps1'; 參數 = @() }
}

while ($true) {
  Clear-Host
  Write-Host '=========================================================='
  Write-Host '  Beyblade Tracker  更新流程驗收'
  Write-Host '=========================================================='
  Write-Host ''
  Write-Host '  請照 UPDATE-TEST.md 的順序執行。'
  Write-Host ''
  foreach ($key in $items.Keys) {
    $missing = -not (Test-Path -LiteralPath (Join-Path $here $items[$key].腳本))
    Write-Host ("  [$key] " + $items[$key].名稱) -NoNewline
    if ($missing) { Write-Host '   >>> 腳本不存在' -ForegroundColor Red } else { Write-Host '' }
  }
  Write-Host ''
  Write-Host '  [9] 開啟 UPDATE-TEST.md'
  Write-Host '  [0] 離開'
  Write-Host ''
  $choice = (Read-Host '輸入數字後按 Enter').Trim()

  if ($choice -eq '0') { return }
  if ($choice -eq '9') { Start-Process notepad (Join-Path $here 'UPDATE-TEST.md'); continue }

  if (-not $items.Contains($choice)) {
    Write-Host ''
    Write-Host "「$choice」不是有效的選項。" -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    continue
  }

  $script = Join-Path $here $items[$choice].腳本
  if (-not (Test-Path -LiteralPath $script)) {
    Write-Host ''
    Write-Host ">>> 找不到 $script —— 共用資料夾可能沒同步完成。" -ForegroundColor Red
    Read-Host '按 Enter 回到選單' | Out-Null
    continue
  }

  Write-Host ''
  Write-Host ('--- 執行 ' + $items[$choice].腳本 + ' ---') -ForegroundColor Cyan
  Write-Host ''
  # 各腳本自行處理錯誤並寫入結果檔；這裡不讓例外把選單一起帶走。
  try { & $script @($items[$choice].參數) } catch { Write-Host (">>> 執行中斷：" + $_.Exception.Message) -ForegroundColor Red }

  Write-Host ''
  Write-Host '----------------------------------------------------------'
  Write-Host '執行完畢。結果同時寫進本資料夾的 .txt 檔，可以直接給我。'
  Write-Host '----------------------------------------------------------'
  Read-Host '按 Enter 回到選單' | Out-Null
}
