# A-10：解除安裝並選擇「保留資料」。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\a10-uninstall-keep.ps1
#
# 注意：解除安裝過程中請在資料保留提示選「是」。


# 版本不寫死：先讀已安裝的 current.json，讀不到就取 versions 下的第一個目錄。
# 2026-08-29 升 1.0.1 前，這些腳本共有 17 處寫死的 1.0.0，升版會全部失效。
$btInstallRoot = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$installedVersion = $(try { (Get-Content -LiteralPath (Join-Path $btInstallRoot 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { $null })
if (-not $installedVersion) { $installedVersion = (Get-ChildItem -LiteralPath (Join-Path $btInstallRoot 'versions') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1).Name }

$out  = (Join-Path $PSScriptRoot 'a10-result.txt')
$dest = $PSScriptRoot
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir   = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$userDir  = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$db       = Join-Path $userDir 'data\tracker.db'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Beyblade Tracker'
$bundledNode = Join-Path $appDir "versions\$installedVersion\runtime\node.exe"
$systemNode  = 'C:\Program Files\nodejs\node.exe'
$counter = Join-Path $dest 'db-counts.mjs'

function Get-Node {
  if (Test-Path -LiteralPath $bundledNode) { return $bundledNode }
  if (Test-Path -LiteralPath $systemNode) { return $systemNode }
  return $null
}

function Read-DbState([string]$label) {
  $node = Get-Node
  if (-not $node) { Log ("[$label] 找不到可用的 node，略過資料庫檢查"); return }
  if (-not (Test-Path -LiteralPath $db)) { Log ("[$label] tracker.db 不存在"); return }
  $prev = [Console]::OutputEncoding
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  try { $r = & $node $counter $db } finally { [Console]::OutputEncoding = $prev }
  Log ("[$label] 使用 node : $node")
  $r | ForEach-Object { Log ("    " + $_) }
}

Log ("=== A-10 解除安裝（保留資料）  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''
Log '########## 解除安裝前 ##########'
Log ''
Log '--- 程式檔案 ---'
Log ("安裝目錄存在   : " + (Test-Path -LiteralPath $appDir))
Log ("current.json   : " + (Test-Path -LiteralPath (Join-Path $appDir 'current.json')))
Log ("開始功能表捷徑 : " + (Test-Path -LiteralPath $startMenu))
if (Test-Path -LiteralPath $startMenu) { Get-ChildItem -LiteralPath $startMenu | ForEach-Object { Log ("    " + $_.Name) } }
$run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).BeybladeTracker
Log ("Run 機碼       : " + $(if ($run) { $run } else { '未設定' }))
$uninst = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like '*Beyblade*' }
Log ("解除安裝登錄   : " + $(if ($uninst) { $uninst.DisplayName + ' ' + $uninst.DisplayVersion } else { '不存在' }))

Log ''
Log '--- 使用者資料 ---'
if (Test-Path -LiteralPath $userDir) {
  Get-ChildItem -LiteralPath $userDir -Recurse -File -ErrorAction SilentlyContinue |
    ForEach-Object { Log ("    {0,-46} {1,10}" -f $_.FullName.Replace($userDir, '...'), $_.Length) }
} else { Log '    使用者資料目錄不存在' }

Log ''
Read-DbState '前'

Log ''
Log '======================================================================'
Log ' 請開啟「設定 → 應用程式 → 已安裝的應用程式」，找到 Beyblade Tracker，'
Log ' 選擇「解除安裝」。'
Log ''
Log ' ⚠ 出現資料保留提示時，請選「是」（保留商品、歷史、設定與備份）。'
Log '======================================================================'
Read-Host '解除安裝完成後按 Enter'

# 提早按 Enter 會讓下方檢查在解除安裝之前就量測，輸出與「解除安裝失敗」完全無法區分
# （2026-08-11 就這樣誤判過一次）。所以這裡等安裝目錄真的消失，而不是相信那個 Enter。
if (Test-Path -LiteralPath $appDir) {
  Write-Host '安裝目錄仍在。若解除安裝精靈還開著請完成它；若尚未開始，請現在執行。' -ForegroundColor Yellow
  Write-Host '最多等待 5 分鐘…' -ForegroundColor Yellow
  for ($w = 0; $w -lt 60 -and (Test-Path -LiteralPath $appDir); $w++) { Start-Sleep -Seconds 5 }
}
if (Test-Path -LiteralPath $appDir) {
  Log ''
  Log '>>> 等待逾時：安裝目錄仍然存在。這代表解除安裝未執行或未完成，'
  Log '>>> 而不是「解除安裝後檢查失敗」。下方檢查不具參考價值，請重跑本腳本。'
}

Start-Sleep -Seconds 3
Log ''
Log '########## 解除安裝後 ##########'
Log ''
Log '--- 程式檔案應已移除 ---'
$appGone = -not (Test-Path -LiteralPath $appDir)
$menuGone = -not (Test-Path -LiteralPath $startMenu)
$run2 = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).BeybladeTracker
$uninst2 = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like '*Beyblade*' }
Log ("安裝目錄已移除   : $appGone")
if (-not $appGone) { Get-ChildItem -LiteralPath $appDir -ErrorAction SilentlyContinue | ForEach-Object { Log ("    殘留: " + $_.Name) } }
Log ("開始功能表已移除 : $menuGone")
Log ("Run 機碼已移除   : " + (-not $run2))
if ($run2) { Log ("    殘留值: $run2") }
Log ("解除安裝登錄已移除 : " + (-not $uninst2))

Log ''
Log '--- 服務應已停止 ---'
$listen = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
Log ("8787 監聽 : " + $(if ($listen) { '>>> 仍在監聽（異常）' } else { '已停止' }))
$nodeProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'Beyblade' }
Log ("Beyblade node 行程 : " + $(if ($nodeProcs) { '>>> 仍存在' } else { '無' }))

Log ''
Log '--- 使用者資料應完整保留 ---'
if (Test-Path -LiteralPath $userDir) {
  Get-ChildItem -LiteralPath $userDir -Recurse -File -ErrorAction SilentlyContinue |
    ForEach-Object { Log ("    {0,-46} {1,10}" -f $_.FullName.Replace($userDir, '...'), $_.Length) }
} else { Log '    >>> FAIL：使用者資料目錄已被刪除' }

Log ''
Read-DbState '後'

Log ''
Log '判定要點：程式檔案／捷徑／Run 機碼／登錄項目應全部消失；'
Log '          使用者資料應保留，且各表筆數與 integrity_check 與「前」相同。'
Log '          tracker.db 的位元組大小可能改變（服務停止時 WAL 併回主檔），這不算資料遺失。'
Log ''
Log ("完成，結果已寫入 " + $out)
Log ('下一步：A-11 需要重新安裝，安裝器在 ' + $dest)
